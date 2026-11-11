import { prepareHistoryCsv } from "@/lib/history-csv";

export { prepareHistoryCsv } from "@/lib/history-csv";

export async function downloadHistoryCsv(uid: string) {
  const result = await prepareHistoryCsv(uid);
  if (result.count > 0) {
    throw new Error("Unduh CSV tidak didukung pada platform ini.");
  }
  return result;
}
