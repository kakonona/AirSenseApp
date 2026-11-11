import type { Recommendation } from "../components/recommendation-card";

export interface AirQualityData {
  aqi: number;
  status:
    | "baik"
    | "sedang"
    | "tidak_sehat_kelompok_sensitif"
    | "tidak_sehat"
    | "sangat_tidak_sehat";
  water: number;
  airPollutionIndex: number;
  location: string;
  lastUpdated: string;
}

export const getStatus = (aqi: number): AirQualityData["status"] => {
  if (aqi <= 50) return "baik";
  if (aqi <= 100) return "sedang";
  if (aqi <= 150) return "tidak_sehat_kelompok_sensitif";
  if (aqi <= 200) return "tidak_sehat";
  return "sangat_tidak_sehat";
};

export const getRecommendations = (
  status: AirQualityData["status"],
  aqi: number,
): Recommendation[] => {
  const recommendationsByStatus: Record<
    AirQualityData["status"],
    Recommendation[]
  > = {
    baik: [
      {
        id: "1",
        icon: "hiking",
        title: "Kondisi udara baik",
        description: "Aktivitas outdoor aman dilakukan untuk semua orang",
        aqiScore: aqi,
      },
      {
        id: "2",
        icon: "wind",
        title: "Angin bertiup lembut",
        description: "Polusi udara tersebar dengan baik di area ini",
        aqiScore: aqi,
      },
    ],
    sedang: [
      {
        id: "1",
        icon: "accessibility",
        title: "Gunakan masker saat bersama",
        description: "Hindari kontak langsung dengan polusi udara di area ini",
        aqiScore: aqi,
      },
      {
        id: "2",
        icon: "favorite",
        title: "Jaga kesehatan",
        description: "Minum air yang cukup dan istirahat yang nyenyak",
        aqiScore: aqi,
      },
    ],
    tidak_sehat_kelompok_sensitif: [
      {
        id: "1",
        icon: "accessibility",
        title: "Gunakan masker N95 atau sejenis",
        description:
          "Terutama kelompok sensitif: anak-anak, lansia, penderita asma",
        aqiScore: aqi,
      },
      {
        id: "2",
        icon: "home",
        title: "Mengurangi aktivitas outdoor",
        description: "Kurangi waktu berada di luar rumah jika memungkinkan",
        aqiScore: aqi,
      },
    ],
    tidak_sehat: [
      {
        id: "1",
        icon: "mask",
        title: "Gunakan masker berkualitas tinggi",
        description:
          "Wajib menggunakan masker N95 atau P100 untuk aktivitas outdoor",
        aqiScore: aqi,
      },
      {
        id: "2",
        icon: "home",
        title: "Hindari aktivitas outdoor",
        description: "Tetap di dalam ruangan dan gunakan air purifier",
        aqiScore: aqi,
      },
    ],
    sangat_tidak_sehat: [
      {
        id: "1",
        icon: "warning",
        title: "Tetap di dalam ruangan",
        description: "Hindari aktivitas outdoor sepenuhnya",
        aqiScore: aqi,
      },
      {
        id: "2",
        icon: "healing",
        title: "Kunjungi dokter jika ada gejala",
        description:
          "Segera konsultasikan dengan dokter jika merasa tidak sehat",
        aqiScore: aqi,
      },
    ],
  };

  return recommendationsByStatus[status];
};

export const mockAirQualityData: AirQualityData = {
  aqi: 63,
  status: getStatus(63),
  water: 96,
  airPollutionIndex: 82,
  location: "Hai Nopal!",
  lastUpdated: "Sabtu, 25 Mei 2025",
};

export const mockRecommendations = getRecommendations(
  mockAirQualityData.status,
  mockAirQualityData.aqi,
);

export const statusLabels: Record<AirQualityData["status"], string> = {
  baik: "Baik",
  sedang: "Sedang",
  tidak_sehat_kelompok_sensitif: "Tidak Sehat (Kelompok Sensitif)",
  tidak_sehat: "Tidak Sehat",
  sangat_tidak_sehat: "Sangat Tidak Sehat",
};

export const statusColors: Record<
  AirQualityData["status"],
  { bg: string; text: string; border: string }
> = {
  baik: {
    bg: "bg-green-100",
    text: "text-green-700",
    border: "border-green-300",
  },
  sedang: {
    bg: "bg-yellow-100",
    text: "text-yellow-700",
    border: "border-yellow-300",
  },
  tidak_sehat_kelompok_sensitif: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    border: "border-orange-300",
  },
  tidak_sehat: {
    bg: "bg-red-100",
    text: "text-red-700",
    border: "border-red-300",
  },
  sangat_tidak_sehat: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    border: "border-purple-300",
  },
};

export const progressColors: Record<AirQualityData["status"], string> = {
  baik: "#22c55e",
  sedang: "#eab308",
  tidak_sehat_kelompok_sensitif: "#f97316",
  tidak_sehat: "#ef4444",
  sangat_tidak_sehat: "#a855f7",
};
