import { db } from "@/lib/firebase";
import { pendingDocs } from "@/lib/offline-queue";
import {
  Timestamp,
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";

export type Period = "Hari" | "Minggu" | "Bulan" | "Tahun" | "Semua";
export type Option = {
  key: string;
  label: string;
  start?: number;
  end?: number;
}; // ms, end eksklusif
export type Series = { labels: string[]; values: number[] };
export type Data = {
  aqi: Series;
  hr: Series;
  spo2: Series;
  resolution?: string; // keterangan granularitas yang dipakai (mis. "per bulan")
};

const DAY = 86400000;
const DAY_FULL = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];
const DAY_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
const pad = (n: number) => String(n).padStart(2, "0");

function emptyData(): Data {
  const emptySeries = { labels: [], values: [] };
  return { aqi: emptySeries, hr: emptySeries, spo2: emptySeries };
}

// ── Pilihan dropdown (murni kalender, tidak baca database) ───────────────────
export function buildOptions(period: Period): Option[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const out: Option[] = [];

  if (period === "Hari") {
    for (let i = 0; i < 14; i++) {
      const s = new Date(y, m, d - i);
      const e = new Date(y, m, d - i + 1);
      out.push({
        key: `d${i}`,
        label: `${DAY_FULL[s.getDay()]}, ${s.getDate()} ${MONTHS[s.getMonth()]} ${s.getFullYear()}`,
        start: s.getTime(),
        end: e.getTime(),
      });
    }
  } else if (period === "Minggu") {
    const dow = (now.getDay() + 6) % 7; // Senin = 0
    for (let i = 0; i < 8; i++) {
      const s = new Date(y, m, d - dow - i * 7);
      const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
      const last = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 1);
      const label =
        s.getMonth() === last.getMonth()
          ? `${s.getDate()}–${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
          : `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${last.getDate()} ${MONTHS_SHORT[last.getMonth()]} ${last.getFullYear()}`;
      out.push({ key: `w${i}`, label, start: s.getTime(), end: e.getTime() });
    }
  } else if (period === "Bulan") {
    for (let i = 0; i < 12; i++) {
      const s = new Date(y, m - i, 1);
      const e = new Date(y, m - i + 1, 1);
      out.push({
        key: `m${i}`,
        label: `${MONTHS[s.getMonth()]} ${s.getFullYear()}`,
        start: s.getTime(),
        end: e.getTime(),
      });
    }
  } else if (period === "Tahun") {
    for (let i = 0; i < 3; i++) {
      out.push({
        key: `y${y - i}`,
        label: `${y - i}`,
        start: new Date(y - i, 0, 1).getTime(),
        end: new Date(y - i + 1, 0, 1).getTime(),
      });
    }
  } else {
    out.push({
      key: "all",
      label: "Semua data",
    });
  }
  return out;
}

// ── Baca + olah ──────────────────────────────────────────────────────────────
// Field null = tidak terukur pada siklus itu (mis. jari tidak terdeteksi). Tiap seri
// dirata-rata sendiri, jadi siklus tanpa SpO2/BPM tetap mengisi chart AQI.
type Key = "aqi" | "spo2" | "bpm";
const KEYS: Key[] = ["aqi", "spo2", "bpm"];
type Rec = { t: number; aqi: number | null; spo2: number | null; bpm: number | null };
export type HistoryRecord = {
  historyId: string;
  timestamp: number;
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  co: number | null;
  spo2: number | null;
  bpm: number | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toRecord(id: string, x: Record<string, unknown>): HistoryRecord | null {
  if (!(x.timestamp instanceof Timestamp)) return null;
  const r: HistoryRecord = {
    historyId: typeof x.historyId === "string" ? x.historyId : id,
    timestamp: x.timestamp.toMillis(),
    aqi: num(x.aqi),
    pm25: num(x.pm25),
    pm10: num(x.pm10),
    co: num(x.co),
    spo2: num(x.spo2),
    bpm: num(x.bpm),
  };
  return r.aqi === null && r.spo2 === null && r.bpm === null ? null : r;
}

// Firestore + data yang masih tersimpan di HP (belum tersinkron), digabung per id
async function readRecords(uid: string, start?: number, end?: number) {
  const base = collection(db, "profile", uid, "history");
  const ranged = start !== undefined && end !== undefined;
  const q = ranged
    ? query(
        base,
        where("timestamp", ">=", Timestamp.fromMillis(start)),
        where("timestamp", "<", Timestamp.fromMillis(end)),
        orderBy("timestamp"),
      )
    : query(base, orderBy("timestamp"));
  const pending = await pendingDocs(["profile", uid, "history"]).catch(() => []);
  const byId = new Map<string, HistoryRecord>();
  try {
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const r = toRecord(d.id, d.data());
      if (r) byId.set(d.id, r);
    }
  } catch (error) {
    // offline & tidak ada cache: tetap tampilkan data lokal bila ada
    if (pending.length === 0) throw error;
    console.warn("[history] Firestore tidak terjangkau, memakai data lokal:", error);
  }
  for (const p of pending) {
    const r = toRecord(p.id, p.data);
    if (!r) continue;
    if (ranged && (r.timestamp < start || r.timestamp >= end)) continue;
    byId.set(p.id, r);
  }
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function fetchAllHistoryRecords(uid: string): Promise<HistoryRecord[]> {
  return readRecords(uid);
}

async function fetchRaw(uid: string, start?: number, end?: number): Promise<Rec[]> {
  const records = await readRecords(uid, start, end);
  return records.map((r) => ({ t: r.timestamp, aqi: r.aqi, spo2: r.spo2, bpm: r.bpm }));
}

type Acc = { label: string; sum: Record<Key, number>; n: Record<Key, number> };
const newAcc = (label: string): Acc => ({
  label,
  sum: { aqi: 0, spo2: 0, bpm: 0 },
  n: { aqi: 0, spo2: 0, bpm: 0 },
});
function addTo(a: Acc, r: Rec) {
  for (const k of KEYS) {
    const v = r[k];
    if (v === null) continue;
    a.sum[k] += v;
    a.n[k]++;
  }
}
function toData(accs: Acc[], resolution?: string): Data {
  const series = (k: Key): Series => {
    const used = accs.filter((a) => a.n[k] > 0);
    return {
      labels: used.map((a) => a.label),
      values: used.map((a) => Math.round(a.sum[k] / a.n[k])),
    };
  };
  const d: Data = { aqi: series("aqi"), hr: series("bpm"), spo2: series("spo2") };
  if (resolution !== undefined) d.resolution = resolution;
  return d;
}

// Rata-rata per kotak waktu. Kotak tanpa data dibuang → rentang chart mengikuti data.
export function bucket(
  recs: Rec[],
  start: number,
  size: number,
  n: number,
  labelOf: (i: number) => string,
): Data {
  const acc = Array.from({ length: n }, (_, i) => newAcc(labelOf(i)));
  for (const r of recs) {
    const i = Math.floor((r.t - start) / size);
    if (i < 0 || i >= n) continue;
    addTo(acc[i], r);
  }
  return toData(acc);
}

// ── Granularitas adaptif (Tahun & Semua) ─────────────────────────────────────
// Data yang belum genap setahun tetap ditampilkan: pilih satuan waktu terbesar yang
// masih menghasilkan >= 2 titik (tahun -> bulan -> hari -> jam -> per siklus).
type Level = { resolution: string; key: (d: Date) => string; label: (d: Date) => string };

function adaptiveLevels(withYear: boolean, includeYearLevel: boolean): Level[] {
  const levels: Level[] = [];
  if (includeYearLevel) {
    levels.push({
      resolution: "per tahun",
      key: (d) => `${d.getFullYear()}`,
      label: (d) => `${d.getFullYear()}`,
    });
  }
  levels.push(
    {
      resolution: "per bulan",
      key: (d) => `${d.getFullYear()}-${d.getMonth()}`,
      label: (d) =>
        withYear
          ? `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
          : MONTHS_SHORT[d.getMonth()],
    },
    {
      resolution: "per hari",
      key: (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      label: (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
    },
    {
      resolution: "per jam",
      key: (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`,
      label: (d) => `${pad(d.getHours())}.00`,
    },
    {
      resolution: "",
      key: (d) => String(d.getTime()),
      label: (d) => `${pad(d.getHours())}.${pad(d.getMinutes())}`,
    },
  );
  return levels;
}

function groupBy(recs: Rec[], level: Level): Data {
  const groups: Acc[] = [];
  let lastKey: string | null = null;
  for (const r of recs) {
    const d = new Date(r.t);
    const k = level.key(d);
    if (k !== lastKey) {
      groups.push(newAcc(level.label(d)));
      lastKey = k;
    }
    addTo(groups[groups.length - 1], r);
  }
  return toData(groups, level.resolution);
}

// recs harus urut waktu naik
function adaptive(recs: Rec[], withYear: boolean, includeYearLevel: boolean): Data {
  if (recs.length === 0) return emptyData();
  const levels = adaptiveLevels(withYear, includeYearLevel);
  for (const level of levels) {
    const keys = new Set(recs.map((r) => level.key(new Date(r.t))));
    if (keys.size >= 2) return groupBy(recs, level);
  }
  return groupBy(recs, levels[levels.length - 1]);
}

export async function fetchHistory(
  uid: string,
  period: Period,
  o: Option,
): Promise<Data> {
  if (period === "Semua") {
    // tahun -> bulan -> hari -> jam -> per siklus, sesuai rentang data yang ada
    return adaptive(await fetchRaw(uid), true, true);
  }

  const { start, end } = o;
  if (start === undefined || end === undefined) {
    throw new Error("Rentang tanggal riwayat tidak tersedia.");
  }

  if (period === "Tahun") {
    const y = new Date(start).getFullYear();
    const recs = await fetchRaw(
      uid,
      new Date(y, 0, 1).getTime(),
      new Date(y + 1, 0, 1).getTime(),
    );
    // per bulan bila data >= 2 bulan; kalau belum, turun ke hari / jam / per siklus
    return adaptive(recs, false, false);
  }

  const recs = await fetchRaw(uid, start, end);
  if (period === "Hari") {
    // 1 titik per siklus ukur, label = jam.menit data diterima
    return toData(
      recs.map((r) => {
        const t = new Date(r.t);
        const a = newAcc(`${pad(t.getHours())}.${pad(t.getMinutes())}`);
        addTo(a, r);
        return a;
      }),
    );
  }
  if (period === "Minggu")
    return bucket(recs, start, DAY, 7, (i) => DAY_SHORT[i]);
  const days = Math.round((end - start) / DAY); // Bulan
  return bucket(recs, start, DAY, days, (i) => String(i + 1));
}
