export type ThresholdStatus = "normal" | "warning" | "danger";
export type AlertParameter = "SpO2" | "BPM" | "AQI";

export function parameterThreshold(
  parameter: AlertParameter,
  value: number | null,
): ThresholdStatus {
  if (value === null || !Number.isFinite(value)) return "normal";

  if (parameter === "SpO2") {
    return value < 90 ? "danger" : value < 95 ? "warning" : "normal";
  }
  if (parameter === "BPM") {
    return value < 60 || value > 100 ? "warning" : "normal";
  }
  return value > 100 ? "warning" : "normal";
}

export function thresholdStatusForReading(reading: {
  aqi: number | null;
  spo2: number | null;
  bpm: number | null;
}): ThresholdStatus {
  const statuses = [
    parameterThreshold("SpO2", reading.spo2),
    parameterThreshold("BPM", reading.bpm),
    parameterThreshold("AQI", reading.aqi),
  ];
  if (statuses.includes("danger")) return "danger";
  if (statuses.includes("warning")) return "warning";
  return "normal";
}
