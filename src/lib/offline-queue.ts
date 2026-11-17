import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "@/lib/firebase";
import { commitWrites, idToken, setWrite, type CommitResult } from "@/lib/firestore-rest";
import { Timestamp } from "firebase/firestore";
import { AppState } from "react-native";

// ── Antrean tulis Firestore yang tahan offline ───────────────────────────────
// Setiap tulisan riwayat / notifikasi disimpan dulu di HP (AsyncStorage), baru dikirim.
// Bila HP tanpa sinyal, data tetap aman di HP dan disinkronkan:
//  - tiap 1 jam secara otomatis,
//  - segera setelah internet kembali (dicoba tiap 1 menit selama antrean berisi),
//  - saat aplikasi kembali dibuka,
//  - setiap ada data baru masuk.
//
// Pengiriman memakai Firestore REST (lihat firestore-rest.ts), bukan setDoc SDK.
//
// Satu HP bisa dipakai bergantian oleh beberapa akun. Tiap data di antrean mencatat
// pemiliknya (path = profile/{uid}/...), dan HANYA data milik akun yang sedang login yang
// dihitung, ditampilkan, dan dikirim. Data akun lain tetap tersimpan di HP dan baru
// tersinkron saat pemiliknya login lagi; tidak pernah masuk ke akun orang lain.

type Encoded = unknown; // Timestamp disimpan sebagai { __ts: ms }
export type QueuedWrite = {
  id: string; // unik per dokumen (path), tulisan ulang ke path sama menimpa antrean lama
  path: string[];
  data: Record<string, Encoded>;
  merge: boolean;
  queuedAt: number;
  attempts?: number; // berapa kali ditolak Firestore
};

export type SyncState = {
  pending: number; // jumlah data akun ini di HP yang belum tersinkron
  syncing: boolean;
  lastError: string | null; // alasan sinkron terakhir gagal (null = tidak ada masalah)
  lastSyncAt: number | null;
};

const STORAGE_KEY = "airsense:offline-writes:v1";
const SYNC_INTERVAL_MS = 60 * 60_000; // sinkron otomatis tiap 1 jam
const RETRY_INTERVAL_MS = 60_000; // coba lagi tiap 1 menit selama ada antrean
const TIMEOUT_BACKOFF_MAX_MS = 30 * 60_000;
const CHUNK = 40; // dokumen per permintaan commit
const MAX_REJECTS = 5; // ditolak sebanyak ini -> dibuang agar tidak menyumbat antrean
const MAX_QUEUE = 5_000;
const MAX_RECENT = 1_500; // dokumen yang baru tersinkron, diingat selama app berjalan

let queue: QueuedWrite[] | null = null;
// Dokumen yang sudah terkirim pada sesi ini. Layar riwayat memakainya supaya tidak perlu
// membaca ulang Firestore tiap ada data baru (menghemat kuota baca harian).
const recent: QueuedWrite[] = [];
let loading: Promise<QueuedWrite[]> | null = null;
let flushing: Promise<number> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let state: SyncState = { pending: 0, syncing: false, lastError: null, lastSyncAt: null };
const pendingListeners = new Set<(pending: number) => void>();
const stateListeners = new Set<(state: SyncState) => void>();

// Permintaan yang jawabannya tidak datang (timeout) mungkin sudah diterapkan server.
// Mengulangnya tiap menit berarti menulis dokumen yang sama berkali-kali (memakan kuota),
// jadi percobaan otomatis berikutnya dijarangkan: 2, 4, 8, 16, lalu tiap 30 menit.
let timeoutStreak = 0;
let autoBlockedUntil = 0;

function noteAnswer(result: CommitResult) {
  if (!result.ok && result.timedOut) {
    timeoutStreak++;
    autoBlockedUntil =
      Date.now() + Math.min(TIMEOUT_BACKOFF_MAX_MS, RETRY_INTERVAL_MS * 2 ** timeoutStreak);
  } else if (result.ok || result.status !== 0) {
    // server menjawab dengan pasti (berhasil / ditolak) -> tidak ada risiko tulisan dobel
    timeoutStreak = 0;
    autoBlockedUntil = 0;
  }
}

function setState(patch: Partial<SyncState>) {
  const pendingChanged = patch.pending !== undefined && patch.pending !== state.pending;
  state = { ...state, ...patch };
  for (const listener of stateListeners) listener(state);
  if (pendingChanged) for (const listener of pendingListeners) listener(state.pending);
}

const isOwn = (item: QueuedWrite, uid: string | undefined) => !!uid && item.path[1] === uid;

// Jumlah data di antrean milik akun yang sedang login
function ownCount() {
  const uid = auth.currentUser?.uid;
  return (queue ?? []).filter((item) => isOwn(item, uid)).length;
}

function encode(value: unknown): Encoded {
  if (value instanceof Timestamp) return { __ts: value.toMillis() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

function isTs(value: unknown): value is { __ts: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.__ts === "number" && Object.keys(obj).length === 1;
}

function decode(value: Encoded): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (isTs(value)) return Timestamp.fromMillis(value.__ts);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, decode(v)]),
    );
  }
  return value;
}

const toWrite = (item: QueuedWrite) => setWrite(item.path, item.data, item.merge);

// Satu kali baca dari storage; pemanggil bersamaan memakai array yang sama
function load(): Promise<QueuedWrite[]> {
  if (queue) return Promise.resolve(queue);
  loading ??= (async () => {
    let parsed: unknown = [];
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : [];
    } catch (error) {
      console.error("[sync] Antrean offline rusak, dimulai ulang:", error);
    }
    queue ??= Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
    setState({ pending: ownCount() });
    return queue;
  })();
  return loading;
}

async function persist() {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue ?? []));
  const n = ownCount();
  setState({ pending: n });
  if (n > 0) ensureRetry();
  else stopRetry();
}

// Ditolak karena isi/izin dokumen itu sendiri (bukan karena jaringan)
const isRejection = (status: number) => status === 400 || status === 403 || status === 404;

function removeItems(items: QueuedWrite[], sent: QueuedWrite[], delivered = false) {
  // item bisa sudah diganti versi lebih baru saat menunggu -> hapus hanya objek yang terkirim
  for (const item of sent) {
    const idx = items.indexOf(item);
    if (idx >= 0) items.splice(idx, 1);
    if (delivered) recent.push(item);
  }
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT);
}

function describeFailure(result: { status: number; message: string }) {
  if (result.status === 0) return result.message;
  if (result.status === 429) {
    return "Kuota harian Firebase (paket gratis) habis, sinkron dilanjutkan otomatis setelah kuota pulih";
  }
  return `Firebase: ${result.message}`;
}

// Simpan di HP dulu (selesai = data aman walau app ditutup), lalu coba kirim.
export async function enqueueWrite(
  path: string[],
  data: Record<string, unknown>,
  merge = false,
) {
  const items = await load();
  const id = path.join("/");
  const item: QueuedWrite = {
    id,
    path,
    data: encode(data) as Record<string, Encoded>,
    merge,
    queuedAt: Date.now(),
  };
  const existing = items.findIndex((q) => q.id === id);
  if (existing >= 0) {
    // merge: gabungkan field; set penuh: ganti
    const prev = items[existing];
    items[existing] =
      merge && prev.merge ? { ...item, data: { ...prev.data, ...item.data } } : item;
  } else {
    items.push(item);
    if (items.length > MAX_QUEUE) items.splice(0, items.length - MAX_QUEUE);
  }
  await persist();
  void flushQueue();
}

// Kirim antrean milik akun yang sedang login ke Firestore. Mengembalikan jumlah dokumen
// yang terkirim. manual = diminta pengguna (tombol sinkron / app dibuka): selalu dicoba.
export function flushQueue(manual = false): Promise<number> {
  if (!manual && !flushing && Date.now() < autoBlockedUntil) return Promise.resolve(0);
  flushing ??= (async () => {
    let sent = 0;
    let error: string | null = null;
    try {
      const items = await load();
      const user = auth.currentUser;
      if (!user || !items.some((q) => isOwn(q, user.uid))) return 0;

      setState({ syncing: true });
      let token: string;
      try {
        token = await idToken();
      } catch {
        error = "Tidak ada koneksi internet";
        return 0;
      }

      const skipped = new Set<QueuedWrite>(); // ditolak pada putaran ini, dicoba lagi nanti
      for (;;) {
        // hanya data milik akun yang sedang login
        const chunk = items.filter((q) => !skipped.has(q) && isOwn(q, user.uid)).slice(0, CHUNK);
        if (chunk.length === 0) break;

        const result = await commitWrites(chunk.map(toWrite), token);
        noteAnswer(result);
        if (result.ok) {
          removeItems(items, chunk, true);
          sent += chunk.length;
          await persist();
          continue;
        }
        if (!isRejection(result.status)) {
          error = describeFailure(result);
          break;
        }

        // Satu dokumen bermasalah menggagalkan seluruh paket -> kirim satu per satu
        let stop = false;
        for (const item of chunk) {
          const single = await commitWrites([toWrite(item)], token);
          noteAnswer(single);
          if (single.ok) {
            removeItems(items, [item], true);
            sent++;
            continue;
          }
          if (!isRejection(single.status)) {
            error = describeFailure(single);
            stop = true;
            break;
          }
          item.attempts = (item.attempts ?? 0) + 1;
          if (single.status === 400 || item.attempts >= MAX_REJECTS) {
            console.error(`[sync] Dokumen ${item.id} ditolak Firestore, dibuang:`, single.message);
            removeItems(items, [item]);
          } else {
            console.warn(`[sync] Dokumen ${item.id} ditolak (${single.message}), dicoba lagi nanti`);
            error = `Firebase menolak data: ${single.message}`;
            skipped.add(item);
          }
        }
        await persist();
        if (stop) break;
      }
      if (sent > 0) console.log(`[sync] ${sent} data tersinkron ke Firebase`);
      if (error) console.warn(`[sync] Sinkron belum selesai (${ownCount()} data di HP): ${error}`);
      return sent;
    } catch (unexpected) {
      error = unexpected instanceof Error ? unexpected.message : String(unexpected);
      console.error("[sync] Sinkron gagal:", unexpected);
      return sent;
    } finally {
      flushing = null;
      setState({
        syncing: false,
        lastError: error,
        ...(sent > 0 ? { lastSyncAt: Date.now() } : {}),
      });
    }
  })();
  return flushing;
}

// Dokumen lokal di bawah satu koleksi (mis. profile/uid/history): yang masih menunggu
// sinkron + yang baru tersinkron pada sesi ini. Layar riwayat menampilkannya langsung
// tanpa menunggu / membaca ulang Firestore.
export async function pendingDocs(collectionPath: string[]) {
  const prefix = collectionPath.join("/") + "/";
  const waiting = await load();
  return [...recent, ...waiting]
    .filter((q) => q.id.startsWith(prefix) && !q.id.slice(prefix.length).includes("/"))
    .map((q) => ({
      id: q.path[q.path.length - 1],
      data: decode(q.data) as Record<string, unknown>,
    }));
}

export async function pendingCount() {
  await load();
  return ownCount();
}

// Dipanggil saat jumlah data yang belum tersinkron berubah
export function subscribePending(listener: (pending: number) => void) {
  pendingListeners.add(listener);
  void pendingCount().then(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

// Status lengkap (jumlah, sedang sinkron, error terakhir) untuk ditampilkan di layar
export function subscribeSync(listener: (state: SyncState) => void) {
  stateListeners.add(listener);
  listener(state);
  void load();
  return () => {
    stateListeners.delete(listener);
  };
}

function ensureRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(() => void flushQueue(), RETRY_INTERVAL_MS);
}

function stopRetry() {
  if (!retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

// Panggil tiap ada akun yang login (root layout); cleanup dipanggil saat logout.
export function startOfflineSync() {
  if (syncTimer) return () => {};
  syncTimer = setInterval(() => void flushQueue(), SYNC_INTERVAL_MS);
  const appState = AppState.addEventListener("change", (next) => {
    if (next === "active") void flushQueue(true);
  });
  void load().then(() => {
    // Akun bisa berganti tanpa app ditutup -> hitung ulang untuk akun yang sekarang login
    const n = ownCount();
    setState({ pending: n, lastError: null });
    if (n > 0) ensureRetry();
    void flushQueue(true);
  });
  return () => {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    stopRetry();
    appState.remove();
    setState({ pending: 0, lastError: null });
  };
}
