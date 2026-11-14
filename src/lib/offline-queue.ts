import AsyncStorage from "@react-native-async-storage/async-storage";
import { db } from "@/lib/firebase";
import { Timestamp, doc, setDoc } from "firebase/firestore";
import { AppState } from "react-native";

// ── Antrean tulis Firestore yang tahan offline ───────────────────────────────
// Setiap tulisan riwayat / notifikasi disimpan dulu di HP (AsyncStorage), baru dikirim.
// Bila HP tanpa sinyal, data tetap aman di HP dan disinkronkan:
//  - tiap 1 jam secara otomatis,
//  - segera setelah internet terdeteksi kembali (dicek tiap 1 menit selama antrean berisi),
//  - saat aplikasi kembali dibuka,
//  - setiap ada data baru masuk.

type Encoded = unknown; // Timestamp disimpan sebagai { __ts: ms }
export type QueuedWrite = {
  id: string; // unik per dokumen (path), tulisan ulang ke path sama menimpa antrean lama
  path: string[];
  data: Record<string, Encoded>;
  merge: boolean;
  queuedAt: number;
};

const STORAGE_KEY = "airsense:offline-writes:v1";
const SYNC_INTERVAL_MS = 60 * 60_000; // sinkron otomatis tiap 1 jam
const PROBE_INTERVAL_MS = 60_000; // cek internet tiap 1 menit selama ada antrean
const WRITE_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 6_000;
const MAX_QUEUE = 5_000;
const PROBE_URLS = [
  ...(process.env.EXPO_PUBLIC_ALERT_API_URL
    ? [`${process.env.EXPO_PUBLIC_ALERT_API_URL.replace(/\/+$/, "")}/health`]
    : []),
  "https://www.gstatic.com/generate_204",
];

let queue: QueuedWrite[] | null = null;
let loading: Promise<QueuedWrite[]> | null = null;
let flushing: Promise<number> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(pending: number) => void>();

function encode(value: unknown): Encoded {
  if (value instanceof Timestamp) return { __ts: value.toMillis() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  }
  return value;
}

function decode(value: Encoded): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__ts === "number" && Object.keys(obj).length === 1) {
      return Timestamp.fromMillis(obj.__ts);
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

// Satu kali baca dari storage; pemanggil bersamaan memakai array yang sama
// (sebelumnya dua pemanggil bersamaan bisa membuat dua array -> data hilang).
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
    return queue;
  })();
  return loading;
}

async function persist() {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue ?? []));
  const n = queue?.length ?? 0;
  for (const listener of listeners) listener(n);
  if (n > 0) ensureProbe();
  else stopProbe();
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Cukup salah satu server terjangkau (worker down != HP offline)
async function online() {
  for (const url of PROBE_URLS) {
    if (await probe(url)) return true;
  }
  return false;
}

// Simpan di HP dulu (selesai = data aman walau app ditutup), lalu coba kirim.
export async function enqueueWrite(
  path: string[],
  data: Record<string, unknown>,
  merge = false,
) {
  const items = await load();
  const id = path.join("/");
  const item: QueuedWrite = { id, path, data: encode(data) as Record<string, Encoded>, merge, queuedAt: Date.now() };
  const existing = items.findIndex((q) => q.id === id);
  if (existing >= 0) {
    // merge: gabungkan field; set penuh: ganti
    const prev = items[existing];
    items[existing] = merge && prev.merge
      ? { ...item, data: { ...prev.data, ...item.data } }
      : item;
  } else {
    items.push(item);
    if (items.length > MAX_QUEUE) items.splice(0, items.length - MAX_QUEUE);
  }
  await persist();
  void flushQueue();
}

// Kirim semua antrean ke Firestore. Berhenti di kegagalan pertama (kemungkinan offline).
export function flushQueue(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      const items = await load();
      if (items.length === 0) return 0;
      if (!(await online())) return 0;
      while (items.length > 0) {
        const item = items[0];
        try {
          await withTimeout(
            setDoc(doc(db, item.path.join("/")), decode(item.data) as Record<string, unknown>, {
              merge: item.merge,
            }),
            WRITE_TIMEOUT_MS,
          );
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "permission-denied" || code === "invalid-argument") {
            console.error(`[sync] Dokumen ${item.id} ditolak Firestore, dibuang:`, error);
          } else {
            console.warn(`[sync] Sinkron tertunda (${items.length} data di HP):`, error);
            break;
          }
        }
        // item pertama bisa sudah diganti versi baru saat menunggu -> hapus hanya yang sama
        if (items[0] === item) items.shift();
        else {
          const idx = items.indexOf(item);
          if (idx >= 0) items.splice(idx, 1);
        }
        sent++;
        await persist();
      }
      if (sent > 0) console.log(`[sync] ${sent} data tersinkron ke Firebase`);
      return sent;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// Dokumen yang masih menunggu sinkron di bawah satu koleksi (mis. profile/uid/history),
// supaya layar riwayat tetap menampilkan data yang baru tersimpan di HP.
export async function pendingDocs(collectionPath: string[]) {
  const prefix = collectionPath.join("/") + "/";
  return (await load())
    .filter((q) => q.id.startsWith(prefix) && !q.id.slice(prefix.length).includes("/"))
    .map((q) => ({ id: q.path[q.path.length - 1], data: decode(q.data) as Record<string, unknown> }));
}

export async function pendingCount() {
  return (await load()).length;
}

export function subscribePending(listener: (pending: number) => void) {
  listeners.add(listener);
  void pendingCount().then(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensureProbe() {
  if (probeTimer) return;
  probeTimer = setInterval(() => void flushQueue(), PROBE_INTERVAL_MS);
}

function stopProbe() {
  if (!probeTimer) return;
  clearInterval(probeTimer);
  probeTimer = null;
}

// Panggil sekali saat app jalan (root layout)
export function startOfflineSync() {
  if (syncTimer) return () => {};
  syncTimer = setInterval(() => void flushQueue(), SYNC_INTERVAL_MS);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") void flushQueue();
  });
  void load().then((items) => {
    if (items.length > 0) ensureProbe();
    void flushQueue();
  });
  return () => {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    stopProbe();
    appState.remove();
  };
}
