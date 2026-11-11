import { prepareHistoryCsv } from "@/lib/history-csv";

type DownloadAnchor = {
  href: string;
  download: string;
  style: { display: string };
  click: () => void;
  remove: () => void;
};

declare const document: {
  body: { appendChild: (element: DownloadAnchor) => void };
  createElement: (tag: "a") => DownloadAnchor;
};

declare const window: {
  setTimeout: (callback: () => void, delay: number) => number;
};

export async function downloadHistoryCsv(uid: string) {
  const result = await prepareHistoryCsv(uid);
  if (!result.content) return result;

  const blob = new Blob([result.content], {
    type: "text/csv;charset=utf-8",
    lastModified: Date.now(),
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return result;
}
