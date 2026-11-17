import { app, auth } from "@/lib/firebase";
import { Timestamp } from "firebase/firestore";

// ── Tulis ke Firestore lewat REST (commit) ───────────────────────────────────
// Semua TULISAN aplikasi lewat sini, bukan lewat setDoc/updateDoc SDK. Alasannya:
// SDK mengirim tulisan lewat koneksi stream dan MENGIRIM ULANG sendiri bila balasan
// server tidak sampai ke HP. Di jaringan yang bermasalah, dokumen yang sama bisa terkirim
// ribuan kali dan menghabiskan kuota tulis harian. REST = satu permintaan, satu jawaban
// pasti, tidak ada kirim ulang otomatis.

const PROJECT_ID = app.options.projectId ?? "";
const DOCS_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/${DOCS_ROOT}:commit`;
const TOKEN_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 20_000;

export type RestWrite = Record<string, unknown>;
export type CommitResult =
  | { ok: true }
  // status 0 = tidak ada jawaban. timedOut = permintaan sempat terkirim tapi jawabannya
  // tidak datang, jadi tulisan itu MUNGKIN sudah diterapkan server.
  | { ok: false; status: number; message: string; timedOut: boolean };

// Timestamp yang disimpan di antrean offline (JSON) berbentuk { __ts: ms }
function isStoredTimestamp(value: unknown): value is { __ts: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.__ts === "number" && Object.keys(obj).length === 1;
}

export function restValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(restValue) } };
  if (value instanceof Timestamp) return { timestampValue: value.toDate().toISOString() };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (isStoredTimestamp(value)) return { timestampValue: new Date(value.__ts).toISOString() };
  if (typeof value === "object") {
    return { mapValue: { fields: restFields(value as Record<string, unknown>) } };
  }
  return { nullValue: null };
}

export function restFields(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, restValue(v)]),
  );
}

const fieldPath = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/[`\\]/g, "\\$&")}\``;

const docName = (path: string[]) => `${DOCS_ROOT}/${path.join("/")}`;

// setDoc: menimpa seluruh dokumen. merge = hanya field yang dikirim yang ditimpa.
export function setWrite(path: string[], data: Record<string, unknown>, merge = false): RestWrite {
  return {
    update: { name: docName(path), fields: restFields(data) },
    ...(merge ? { updateMask: { fieldPaths: Object.keys(data).map(fieldPath) } } : {}),
  };
}

// updateDoc: mengubah field tertentu; gagal bila dokumennya belum ada.
export function updateWrite(path: string[], data: Record<string, unknown>): RestWrite {
  return {
    update: { name: docName(path), fields: restFields(data) },
    updateMask: { fieldPaths: Object.keys(data).map(fieldPath) },
    currentDocument: { exists: true },
  };
}

// deleteDoc
export function deleteWrite(path: string[]): RestWrite {
  return { delete: docName(path) };
}

export async function commitWrites(
  writes: RestWrite[],
  token: string,
  timeoutMs = WRITE_TIMEOUT_MS,
): Promise<CommitResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(COMMIT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ writes }),
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string; status?: string } };
      message = body.error?.message ?? body.error?.status ?? message;
    } catch {
      // badan jawaban bukan JSON
    }
    return { ok: false, status: response.status, message, timedOut: false };
  } catch {
    return {
      ok: false,
      status: 0,
      message: timedOut ? "Koneksi internet terlalu lambat" : "Tidak ada koneksi internet",
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function idToken(timeoutMs = TOKEN_TIMEOUT_MS): Promise<string> {
  const user = auth.currentUser;
  if (!user) return Promise.reject(new Error("Belum login"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    user.getIdToken(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Kode error disamakan dengan kode Firestore SDK supaya layar yang sudah ada tetap cocok.
export class FirestoreWriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FirestoreWriteError";
  }
}

function writeError(result: { status: number; message: string }) {
  switch (result.status) {
    case 0:
      return new FirestoreWriteError("unavailable", result.message);
    case 403:
      return new FirestoreWriteError("permission-denied", "Akses ditolak Firestore");
    case 404:
      return new FirestoreWriteError("not-found", "Data tidak ditemukan");
    case 429:
      return new FirestoreWriteError(
        "resource-exhausted",
        "Kuota harian Firebase (paket gratis) habis. Coba lagi setelah kuota pulih.",
      );
    default:
      return new FirestoreWriteError("unknown", `Firebase: ${result.message}`);
  }
}

// Tulis langsung (aksi pengguna: daftar, tambah / terima / hapus kontak). Semua tulisan
// dalam satu panggilan diterapkan bersama. Tidak ada kirim ulang otomatis: bila gagal,
// error dilempar dan pengguna yang mengulang.
export async function writeNow(...writes: RestWrite[]): Promise<void> {
  let token: string;
  try {
    token = await idToken();
  } catch (error) {
    throw new FirestoreWriteError(
      "unavailable",
      error instanceof Error && error.message === "Belum login"
        ? "Belum login"
        : "Tidak ada koneksi internet",
    );
  }
  const result = await commitWrites(writes, token);
  if (!result.ok) throw writeError(result);
}
