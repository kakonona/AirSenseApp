import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Nilai terkini wearable yang disimpan di HP ───────────────────────────────
// HP inilah yang menerima data dari wearable lewat BLE, jadi layar beranda tidak perlu
// menunggu Realtime Database (yang butuh internet). Nilai terakhir juga disimpan ke
// AsyncStorage supaya tetap tampil saat aplikasi dibuka tanpa internet.

export type LocalDevice = {
  status: "online" | "offline";
  wearable_added?: boolean;
  threshold_status: "normal" | "warning" | "danger";
  aqi: number;
  pm25: number;
  pm10: number;
  co: number;
  spo2: number;
  bpm: number;
  received_at_ms?: number;
};

const EMPTY: LocalDevice = {
  status: "offline",
  wearable_added: false,
  threshold_status: "normal",
  aqi: 0,
  pm25: 0,
  pm10: 0,
  co: 0,
  spo2: 0,
  bpm: 0,
};

const PERSIST_EVERY_MS = 5_000; // frame datang ~1/detik; tidak perlu menulis storage tiap frame
const storageKey = (uid: string) => `airsense:device:v1:${uid}`;
const devices = new Map<string, LocalDevice>();
const loads = new Map<string, Promise<void>>();
const lastPersist = new Map<string, number>();
const listeners = new Map<string, Set<(device: LocalDevice | null) => void>>();

function load(uid: string): Promise<void> {
  let pending = loads.get(uid);
  if (!pending) {
    pending = (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey(uid));
        if (!raw) return;
        const stored = JSON.parse(raw) as LocalDevice;
        // Sesi BLE belum tentu aktif saat app baru dibuka -> selalu mulai dari offline
        if (stored && typeof stored === "object") {
          devices.set(uid, { ...EMPTY, ...stored, status: "offline" });
        }
      } catch (error) {
        console.warn("[device] Nilai terakhir di HP tidak terbaca:", error);
      }
    })();
    loads.set(uid, pending);
  }
  return pending;
}

function emit(uid: string) {
  const device = devices.get(uid) ?? null;
  for (const listener of listeners.get(uid) ?? []) listener(device);
}

// Perbarui sebagian nilai. flush = langsung simpan ke storage (perubahan status).
export function patchLocalDevice(uid: string, patch: Partial<LocalDevice>, flush = false) {
  void load(uid).then(() => {
    const next = { ...(devices.get(uid) ?? EMPTY), ...patch };
    devices.set(uid, next);
    emit(uid);
    const now = Date.now();
    if (!flush && now - (lastPersist.get(uid) ?? 0) < PERSIST_EVERY_MS) return;
    lastPersist.set(uid, now);
    AsyncStorage.setItem(storageKey(uid), JSON.stringify(next)).catch((error: unknown) => {
      console.warn("[device] Nilai terakhir tidak tersimpan di HP:", error);
    });
  });
}

export function subscribeLocalDevice(
  uid: string,
  listener: (device: LocalDevice | null) => void,
) {
  let set = listeners.get(uid);
  if (!set) {
    set = new Set();
    listeners.set(uid, set);
  }
  set.add(listener);
  void load(uid).then(() => {
    if (set.has(listener)) listener(devices.get(uid) ?? null);
  });
  return () => {
    set.delete(listener);
  };
}
