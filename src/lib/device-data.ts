import { rtdb } from "@/lib/firebase";
import {
  thresholdStatusForReading,
  type ThresholdStatus,
} from "@/lib/thresholds";
import { processReadingAlerts } from "@/lib/emergency-alerts";
import { enqueueWrite } from "@/lib/offline-queue";
import { onDisconnect, ref, update } from "firebase/database";
import { Timestamp } from "firebase/firestore";

// ── KONTRAK BLE (harus SAMA PERSIS dengan firmware AIRSENSE_V3/ble.cpp) ───────
export const BLE_SERVICE_UUID = "a1b2c3d4-0001-4a5b-9c8d-0123456789ab";
export const BLE_DATA_CHAR_UUID = "a1b2c3d4-0002-4a5b-9c8d-0123456789ab"; // NOTIFY ESP -> app
export const BLE_ACK_CHAR_UUID = "a1b2c3d4-0003-4a5b-9c8d-0123456789ab"; // WRITE  app -> ESP
export const BLE_NAME_PREFIX = "AirSense";

const MAGIC = 0xa5;
const ACK_MAGIC = 0xa6;
const VERSION = 3;
const FRAME_LEN = 20;
const FLAG_FINGER = 0x01;
const FLAG_FINAL = 0x02;
const FLAG_BACKLOG = 0x04;
/*
  Frame v3 (20 byte, little-endian):
  [0] 0xA5 magic        [1] versi (3)
  [2-3] PM2.5 ×10       [4-5] PM10 ×10      [6-7] CO(ppm) ×100
  [8] SpO2 (%)          [9] BPM
  [10-11] seq (id record, dipakai untuk ACK)
  [12-13] AQI ESP32 (0xFFFF = tidak tersedia)
  [14] flags: bit0 jari, bit1 final (hasil jendela ukur), bit2 backlog (hasil siklus lama)
  [15-18] umur data dalam detik (0 = sekarang)
  [19] CRC-8 dari byte 0..18

  ACK app -> ESP (3 byte): [0xA6, seq lo, seq hi]
  ESP mengirim ulang frame final / backlog sampai ACK diterima. Yang tidak sempat
  di-ACK disimpan ESP di memori RTC dan dikirim lagi pada siklus berikutnya.
*/

export type Reading = {
  pm25: number;
  pm10: number;
  co: number;
  aqi: number | null;
  spo2: number | null; // null = jari tidak terdeteksi / data tidak valid
  bpm: number | null;
  seq?: number;
  windowDone?: boolean; // frame final: hasil jendela ukur (perlu ACK)
  backlog?: boolean; // hasil siklus lama yang belum sempat diterima (perlu ACK)
  ageSec?: number; // umur data saat diterima
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
function bytesToBase64(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

// Payload base64 untuk menulis ACK ke characteristic BLE_ACK_CHAR_UUID
export function ackPayload(seq: number) {
  return bytesToBase64([ACK_MAGIC, seq & 0xff, (seq >> 8) & 0xff]);
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
  const flags = bytes[14];
  const fingerOk = (flags & FLAG_FINGER) !== 0;
  const pm25 = v.getUint16(2, true) / 10;
  const pm10 = v.getUint16(4, true) / 10;
  const co = v.getUint16(6, true) / 100;
  const aqiValue = v.getUint16(12, true);
  if (pm25 > 1000 || pm10 > 1000 || co > 1000) return null;
  if (aqiValue !== 0xffff && aqiValue > 500) return null;

  return {
    pm25,
    pm10,
    co,
    aqi: aqiValue === 0xffff ? null : aqiValue,
    spo2: fingerOk && bytes[8] >= 70 && bytes[8] <= 100 ? bytes[8] : null,
    bpm: fingerOk && bytes[9] >= 30 && bytes[9] <= 220 ? bytes[9] : null,
    seq: v.getUint16(10, true),
    windowDone: (flags & FLAG_FINAL) !== 0,
    backlog: (flags & FLAG_BACKLOG) !== 0,
    ageSec: v.getUint32(15, true),
  };
}

export function thresholdStatus(r: {
  aqi: number | null;
  spo2: number | null;
  bpm: number | null;
}): ThresholdStatus {
  return thresholdStatusForReading(r);
}

// ── SIKLUS UKUR (sama dengan firmware cycle.h) ───────────────────────────────
// ESP bangun -> jendela ukur maks 30 dtk (selesai lebih awal bila semua data valid)
// -> kirim frame final sampai di-ACK (maks 20 dtk) -> deep sleep 120 dtk -> ulang.
// 1 frame final / backlog = 1 dokumen riwayat. Dokumen disimpan dulu di HP (antrean
// offline), BARU di-ACK ke ESP, sehingga data tidak hilang walau HP tanpa sinyal.
const NEW_WINDOW_GAP_MS = 15_000; // jeda antar frame lebih dari ini = ESP sempat tidur

export type AckFn = (seq: number) => Promise<void>;

// Frame live satu jendela digabung: dipakai melengkapi field final yang kosong.
let windowUid: string | null = null;
let windowLastFrameAt = 0;
let windowMerged: Reading | null = null;
let windowStored = false; // jendela ini sudah tersimpan (dari frame final)

// Cadangan bila frame final tidak sampai: hasil gabungan jendela disimpan sendiri.
// Kalau final tsb datang belakangan lewat backlog, dokumen yang sama ditimpa (bukan dobel).
const fallbackIds: { seq: number; at: number; id: string }[] = [];

// Record yang sudah diterima (ESP mengirim ulang bila ACK hilang di jalan)
const received: { seq: number; at: number }[] = [];
function alreadyReceived(seq: number, measuredAt: number) {
  return received.some(
    (r) => r.seq === seq && Math.abs(r.at - measuredAt) < 120_000,
  );
}
function markReceived(seq: number, measuredAt: number) {
  received.push({ seq, at: measuredAt });
  if (received.length > 200) received.shift();
}

// Nilai valid terakhir per field (frame awal jendela sering belum lengkap).
function mergeReading(prev: Reading | null, r: Reading): Reading {
  if (!prev) return { ...r };
  return {
    pm25: r.pm25 > 0 ? r.pm25 : prev.pm25,
    pm10: r.pm10 > 0 ? r.pm10 : prev.pm10,
    co: r.co > 0 ? r.co : prev.co,
    aqi: r.aqi ?? prev.aqi,
    spo2: r.spo2 ?? prev.spo2,
    bpm: r.bpm ?? prev.bpm,
    seq: r.seq ?? prev.seq,
  };
}

async function storeRecord(
  uid: string,
  r: Reading,
  measuredAt: number,
  source: "final" | "backlog" | "window",
): Promise<string | null> {
  // Simpan selama ada minimal satu nilai; field kosong (mis. jari tidak terdeteksi) = null
  if (r.aqi === null && r.spo2 === null && r.bpm === null) {
    console.log(`[history] ${source} seq ${r.seq} dilewati: AQI, SpO2 & BPM kosong semua`);
    return null;
  }
  const reuse =
    source === "backlog" && r.seq !== undefined
      ? fallbackIds.find((f) => f.seq === r.seq && Math.abs(f.at - measuredAt) < 180_000)
      : undefined;
  const historyId = reuse?.id ?? `h${Math.floor(measuredAt / 1000)}_${r.seq ?? 0}`;
  await enqueueWrite(["profile", uid, "history", historyId], {
    historyId,
    timestamp: Timestamp.fromMillis(measuredAt),
    measured_at_ms: measuredAt,
    received_at_ms: Date.now(),
    sequence: r.seq ?? null,
    source,
    aqi: r.aqi,
    pm25: r.pm25,
    pm10: r.pm10,
    co: r.co,
    spo2: r.spo2,
    bpm: r.bpm,
  });
  console.log(`[history] ${source} seq ${r.seq} tersimpan di HP (${historyId})`);
  return historyId;
}

// Jendela berakhir tanpa frame final yang tersimpan -> simpan gabungan frame live-nya
async function storeWindowFallback(uid: string) {
  if (!windowMerged || windowStored) return;
  const merged = windowMerged;
  const at = windowLastFrameAt;
  windowStored = true;
  // final ESP memakai seq berikutnya setelah frame live terakhir
  const finalSeq = ((merged.seq ?? 0) + 1) & 0xffff;
  const id = await storeRecord(uid, { ...merged, seq: finalSeq }, at, "window");
  if (id) {
    fallbackIds.push({ seq: finalSeq, at, id });
    if (fallbackIds.length > 50) fallbackIds.shift();
    markReceived(finalSeq, at);
  }
}

// Data sudah diamankan per record saat diterima; saat putus cukup reset jendela.
export async function flushPendingReading(uid: string) {
  if (windowUid === uid) {
    await storeWindowFallback(uid);
    windowUid = null;
    windowMerged = null;
  }
}

// Dipanggil setiap ada frame valid dari wearable
export async function ingestReading(uid: string, r: Reading, ack: AckFn) {
  const now = Date.now();

  // Hasil siklus lama dari backlog ESP: simpan dengan waktu ukur aslinya, lalu ACK.
  if (r.backlog) {
    const measuredAt = now - (r.ageSec ?? 0) * 1000;
    if (r.seq !== undefined) {
      if (!alreadyReceived(r.seq, measuredAt)) {
        await storeRecord(uid, r, measuredAt, "backlog");
        markReceived(r.seq, measuredAt);
      }
      await ack(r.seq);
    }
    return thresholdStatus(r);
  }

  const threshold_status = thresholdStatus(r);
  void processReadingAlerts(uid, r, now).catch((error: unknown) => {
    console.warn("Could not process wearable emergency alerts:", error);
  });

  if (windowUid !== uid || now - windowLastFrameAt > NEW_WINDOW_GAP_MS) {
    if (windowUid === uid) await storeWindowFallback(uid);
    windowUid = uid;
    windowMerged = null;
    windowStored = false;
  }
  windowLastFrameAt = now;

  if (r.windowDone && r.seq !== undefined) {
    // Frame final = snapshot resmi ESP; field kosong dilengkapi dari frame live jendela ini
    if (!alreadyReceived(r.seq, now) && !windowStored) {
      const merged = windowMerged ? mergeReading(windowMerged, r) : r;
      await storeRecord(uid, { ...merged, seq: r.seq }, now, "final");
      markReceived(r.seq, now);
    }
    windowStored = true;
    await ack(r.seq); // data sudah aman di HP -> ESP boleh tidur
  } else {
    windowMerged = mergeReading(windowMerged, r);
  }

  // Realtime Database: nilai terkini (hanya bermakna saat online; tidak diantre)
  const live: Record<string, string | number | boolean | null> = {
    status: "online",
    wearable_added: true,
    threshold_status,
    sequence: r.seq ?? null,
    received_at_ms: now,
    aqi: r.aqi,
    pm25: r.pm25,
    pm10: r.pm10,
    co: r.co,
  };
  if (r.spo2 !== null) live.spo2 = r.spo2;
  if (r.bpm !== null) live.bpm = r.bpm;
  void update(ref(rtdb, `device/${uid}`), live).catch((error: unknown) => {
    console.warn("[live] Gagal memperbarui data terkini (offline?):", error);
  });
  return threshold_status;
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
