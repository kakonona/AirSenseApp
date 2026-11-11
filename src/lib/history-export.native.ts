import { prepareHistoryCsv } from "@/lib/history-csv";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function downloadHistoryCsv(uid: string) {
  const result = await prepareHistoryCsv(uid);
  if (!result.content) return result;

  const file = new File(Paths.cache, result.filename);
  file.create({ overwrite: true });
  file.write(result.content);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Fitur berbagi file tidak tersedia di perangkat ini.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    dialogTitle: "Unduh riwayat AirSense",
    UTI: "public.comma-separated-values-text",
  });
  return result;
}
