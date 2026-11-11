import { db, rtdb } from "@/lib/firebase";
import { onDisconnect, ref, update } from "firebase/database";
import { Timestamp, doc, setDoc } from "firebase/firestore";

// ── KONTRAK BLE (harus SAMA PERSIS dengan firmware) ──────────────────────────
// Buat UUID sendiri (mis. di uuidgenerator.net), lalu pakai yang sama di firmware.
export const BLE_SERVICE_UUID = "a1b2c3d4-0001-4a5b-9c8d-0123456789ab";
export const BLE_DATA_CHAR_UUID = "a1b2c3d4-0002-4a5b-9c8d-0123456789ab"; // NOTIFY
export const BLE_NAME_PREFIX = "AirSense";

const MAGIC = 0xa5;
const VERSION = 1;
const FRAME_LEN = 14;
/*
  Frame 14 byte (little-endian):
  [0] 0xA5 magic        [1] versi (1)
  [2-3] PM2.5 ×10       [4-5] PM10 ×10      [6-7] CO(ppm) ×100
  [8] SpO2 (%)          [9] BPM
  [10-11] seq (counter) [12] flags (bit0 = jari terdeteksi)
  [13] CRC-8 dari byte 0..12
*/

export type Reading = {
  pm25: number;
  pm10: number;
  co: number;
  spo2: number | null; // null = jari tidak terdeteksi / data tidak valid
  bpm: number | null;
  seq?: number;
};

function crc8(bytes: Uint8Array, len: number): number {
  let crc = 0;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
      buf &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}
// Terima nilai base64 dari characteristic BLE → Reading, atau null kalau bukan frame yang valid
export function decodePacket(base64: string): Reading | null {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return null;
  }
  if (bytes.length !== FRAME_LEN) return null;
  if (bytes[0] !== MAGIC || bytes[1] !== VERSION) return null;
  if (crc8(bytes, FRAME_LEN - 1) !== bytes[FRAME_LEN - 1]) return null;

  const v = new DataView(bytes.buffer);
  const fingerOk = (bytes[12] & 0x01) !== 0;
  const pm25 = v.getUint16(2, true) / 10;
  const pm10 = v.getUint16(4, true) / 10;
  const co = v.getUint16(6, true) / 100;
  if (pm25 > 1000 || pm10 > 1000 || co > 1000) return null;

  return {
    pm25,
    pm10,
    co,
    spo2: fingerOk && bytes[8] >= 70 && bytes[8] <= 100 ? bytes[8] : null,
    bpm: fingerOk && bytes[9] >= 30 && bytes[9] <= 220 ? bytes[9] : null,
    seq: v.getUint16(10, true),
  };
}

// PM2.5 (µg/m³) → AQI (US EPA)
const BP = [
  [0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 500.4, 301, 500],
];
export function pm25ToAqi(c: number): number {
  c = Math.floor(c * 10) / 10;
  for (const [cl, ch, il, ih] of BP) {
    if (c <= ch) return Math.round(((ih - il) / (ch - cl)) * (c - cl) + il);
  }
  return 500;
}

export type ThresholdStatus = "normal" | "warning" | "danger";

// Ambang batas — sesuaikan dengan kebutuhan
export function thresholdStatus(r: {
  aqi: number;
  co: number;
  spo2: number | null;
  bpm: number | null;
}): ThresholdStatus {
  const levels = [
    r.aqi > 200 ? 2 : r.aqi > 150 ? 1 : 0,
    r.co > 35 ? 2 : r.co > 9 ? 1 : 0,
    r.spo2 === null ? 0 : r.spo2 < 90 ? 2 : r.spo2 < 94 ? 1 : 0,
    r.bpm === null ? 0 : r.bpm > 140 ? 2 : r.bpm > 120 ? 1 : 0,
  ];
  return (["normal", "warning", "danger"] as const)[Math.max(...levels)];
}

let lastHistoryAt = 0;
const HISTORY_MIN_INTERVAL_MS = 150_000; // jaga kuota tulis Firestore

// Dipanggil setiap ada pembacaan baru yang valid dari wearable
export async function ingestReading(uid: string, r: Reading) {
  const aqi = pm25ToAqi(r.pm25);
  const threshold_status = thresholdStatus({ ...r, aqi });
  const now = Date.now();

  // 1) Realtime Database: nilai terkini, ditimpa terus (pm10 diterima tapi belum
  //    disimpan karena spesifikasi belum punya field-nya)
  const live: Record<string, string | number | boolean> = {
    status: "online",
    wearable_added: true,
    threshold_status,
    aqi,
    pm25: r.pm25,
    pm10: r.pm10,
    co: r.co,
  };
  if (r.spo2 !== null) live.spo2 = r.spo2;
  if (r.bpm !== null) live.bpm = r.bpm;
  await update(ref(rtdb, `device/${uid}`), live);

  // 2) Firestore: riwayat. Maksimal 1 dokumen / 150 dtk, hanya kalau data lengkap
  if (
    r.spo2 !== null &&
    r.bpm !== null &&
    now - lastHistoryAt >= HISTORY_MIN_INTERVAL_MS
  ) {
    lastHistoryAt = now;
    const historyId = `h${Math.floor(now / 1000)}`;
    await setDoc(doc(db, "profile", uid, "history", historyId), {
      historyId,
      timestamp: Timestamp.fromMillis(now),
      aqi,
      pm25: r.pm25,
      pm10: r.pm10,
      co: r.co,
      spo2: r.spo2,
      bpm: r.bpm,
    });
  }
  return threshold_status; // nanti dipakai untuk memicu notifikasi
}

// Kalau HP terputus dari internet / app ditutup, Firebase otomatis set offline
export async function startDeviceSession(uid: string) {
  const deviceRef = ref(rtdb, `device/${uid}`);
  await onDisconnect(deviceRef).update({ status: "offline" });
  await update(deviceRef, { status: "online", wearable_added: true });
}
export async function endDeviceSession(uid: string) {
  await update(ref(rtdb, `device/${uid}`), { status: "offline" });
}
export async function removeDeviceRegistration(uid: string) {
  await update(ref(rtdb, `device/${uid}`), {
    status: "offline",
    wearable_added: false,
  });
}
