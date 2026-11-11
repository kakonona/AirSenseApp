import { fetchAllHistoryRecords } from "@/lib/history-data";

export type HistoryCsv = {
  count: number;
  filename: string;
  content: string | null;
};

const csvValue = (value: string | number | null) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

export async function prepareHistoryCsv(uid: string): Promise<HistoryCsv> {
  const records = await fetchAllHistoryRecords(uid);
  const filename = `airsense-history-${new Date().toISOString().slice(0, 10)}.csv`;
  if (records.length === 0) return { count: 0, filename, content: null };

  const rows = [
    [
      "history_id",
      "timestamp_utc",
      "aqi",
      "pm25_ug_m3",
      "pm10_ug_m3",
      "co_ppm",
      "spo2_percent",
      "bpm",
    ],
    ...records.map((record) => [
      record.historyId,
      new Date(record.timestamp).toISOString(),
      record.aqi,
      record.pm25,
      record.pm10,
      record.co,
      record.spo2,
      record.bpm,
    ]),
  ];
  const content = `\uFEFF${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}`;
  return { count: records.length, filename, content };
}
