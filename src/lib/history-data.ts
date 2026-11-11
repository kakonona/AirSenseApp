import { db } from "@/lib/firebase";
import {
  Timestamp,
  collection,
  getDocs,
  limit,
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
export type Data = { aqi: Series; hr: Series; spo2: Series };

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
type Rec = { t: number; aqi: number; spo2: number; bpm: number };
export type HistoryRecord = {
  historyId: string;
  timestamp: number;
  aqi: number;
  pm25: number | null;
  pm10: number | null;
  co: number | null;
  spo2: number;
  bpm: number;
};

async function fetchRaw(
  uid: string,
  start: number,
  end: number,
): Promise<Rec[]> {
  const q = query(
    collection(db, "profile", uid, "history"),
    where("timestamp", ">=", Timestamp.fromMillis(start)),
    where("timestamp", "<", Timestamp.fromMillis(end)),
    orderBy("timestamp"),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      t: (x.timestamp as Timestamp).toMillis(),
      aqi: x.aqi,
      spo2: x.spo2,
      bpm: x.bpm,
    };
  });
}

// Rata-rata per kotak waktu. Kotak tanpa data dibuang → rentang chart mengikuti data.
export function bucket(
  recs: Rec[],
  start: number,
  size: number,
  n: number,
  labelOf: (i: number) => string,
): Data {
  const acc = Array.from({ length: n }, () => ({
    c: 0,
    aqi: 0,
    spo2: 0,
    bpm: 0,
  }));
  for (const r of recs) {
    const i = Math.floor((r.t - start) / size);
    if (i < 0 || i >= n) continue;
    const a = acc[i];
    a.c++;
    a.aqi += r.aqi;
    a.spo2 += r.spo2;
    a.bpm += r.bpm;
  }
  const used = acc.map((a, i) => ({ a, i })).filter((x) => x.a.c > 0);
  const series = (k: "aqi" | "spo2" | "bpm"): Series => ({
    labels: used.map((x) => labelOf(x.i)),
    values: used.map((x) => Math.round(x.a[k] / x.a.c)),
  });
  return { aqi: series("aqi"), hr: series("bpm"), spo2: series("spo2") };
}

function averageByRanges(
  recs: Rec[],
  ranges: { label: string; start: number; end: number }[],
): Data {
  const totals = ranges.map((range) => ({
    ...range,
    count: 0,
    aqi: 0,
    bpm: 0,
    spo2: 0,
  }));
  let rangeIndex = 0;

  for (const rec of recs) {
    while (rangeIndex < totals.length && rec.t >= totals[rangeIndex].end) {
      rangeIndex++;
    }

    const total = totals[rangeIndex];
    if (!total || rec.t < total.start) continue;
    total.count++;
    total.aqi += rec.aqi;
    total.bpm += rec.bpm;
    total.spo2 += rec.spo2;
  }

  const used = totals.filter((total) => total.count > 0);
  const series = (key: "aqi" | "bpm" | "spo2"): Series => ({
    labels: used.map((total) => total.label),
    values: used.map((total) => Math.round(total[key] / total.count)),
  });
  return { aqi: series("aqi"), hr: series("bpm"), spo2: series("spo2") };
}

export async function fetchAllHistoryRecords(
  uid: string,
): Promise<HistoryRecord[]> {
  const snap = await getDocs(
    query(collection(db, "profile", uid, "history"), orderBy("timestamp")),
  );
  return snap.docs.map((doc) => {
    const record = doc.data();
    if (!(record.timestamp instanceof Timestamp)) {
      throw new Error(`Riwayat ${doc.id} tidak memiliki timestamp yang valid.`);
    }
    return {
      historyId:
        typeof record.historyId === "string" ? record.historyId : doc.id,
      timestamp: record.timestamp.toMillis(),
      aqi: record.aqi as number,
      pm25: (record.pm25 as number | undefined) ?? null,
      pm10: (record.pm10 as number | undefined) ?? null,
      co: (record.co as number | undefined) ?? null,
      spo2: record.spo2 as number,
      bpm: record.bpm as number,
    };
  });
}

export async function fetchHistory(
  uid: string,
  period: Period,
  o: Option,
): Promise<Data> {
  if (period === "Semua") {
    const records = await fetchAllHistoryRecords(uid);
    const recs = records.map(({ timestamp, aqi, spo2, bpm }) => ({
      t: timestamp,
      aqi,
      spo2,
      bpm,
    }));
    if (recs.length === 0) return emptyData();

    const firstYear = new Date(recs[0].t).getFullYear();
    const lastYear = new Date(recs[recs.length - 1].t).getFullYear();
    const ranges = Array.from(
      { length: lastYear - firstYear + 1 },
      (_, index) => {
        const year = firstYear + index;
        return {
          label: String(year),
          start: new Date(year, 0, 1).getTime(),
          end: new Date(year + 1, 0, 1).getTime(),
        };
      },
    );
    return averageByRanges(recs, ranges);
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
    const ranges = MONTHS_SHORT.map((label, mi) => ({
      label,
      start: new Date(y, mi, 1).getTime(),
      end: new Date(y, mi + 1, 1).getTime(),
    }));
    return averageByRanges(recs, ranges);
  }

  const recs = await fetchRaw(uid, start, end);
  if (period === "Hari") {
    const hourly = bucket(recs, start, 3600000, 24, (i) => `${pad(i)}.00`);
    const tenMin = bucket(
      recs,
      start,
      600000,
      144,
      (i) => `${pad(Math.floor(i / 6))}.${pad((i % 6) * 10)}`,
    );
    return { aqi: hourly.aqi, hr: tenMin.hr, spo2: tenMin.spo2 };
  }
  if (period === "Minggu")
    return bucket(recs, start, DAY, 7, (i) => DAY_SHORT[i]);
  const days = Math.round((end - start) / DAY); // Bulan
  return bucket(recs, start, DAY, days, (i) => String(i + 1));
}
