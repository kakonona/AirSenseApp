import React from "react";
import { Text, View } from "react-native";
import { Path, Svg } from "react-native-svg";

// same palette used in AirQualityScore — keep these in sync
const AQI_LEVELS = [
  { max: 50, label: "Baik", color: "#7FB88F" },
  { max: 100, label: "Sedang", color: "#C9A227" },
  { max: 150, label: "Tidak Sehat utk Sensitif", color: "#C97A3D" },
  { max: 200, label: "Tidak Sehat", color: "#C15C55" },
  { max: 300, label: "Sangat Tidak Sehat", color: "#8E5FA3" },
  { max: Infinity, label: "Berbahaya", color: "#7A4A4A" },
];

function getAqiColor(score: number): string {
  return (
    AQI_LEVELS.find((lvl) => score <= lvl.max) ??
    AQI_LEVELS[AQI_LEVELS.length - 1]
  ).color;
}

export interface Recommendation {
  id: string;
  icon?: string;
  title: string;
  description: string;
  aqiScore: number;
}

interface RecommendationCardProps {
  recommendation: Recommendation;
}

// outline warning-triangle icon, matches the reference art style
// (thin stroke, rounded corners, exclamation mark)
const WarningTriangleIcon = ({
  size = 22,
  color = "#C97A3D",
}: {
  size?: number;
  color?: string;
}) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 3.5 L21.5 20 H2.5 Z"
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
      strokeLinecap="round"
      fill="none"
    />
    <Path
      d="M12 9.5 V14"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
    <Path
      d="M12 17 h0.01"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
    />
  </Svg>
);

export const RecommendationCard = React.memo(
  ({ recommendation }: RecommendationCardProps) => {
    const color = getAqiColor(recommendation.aqiScore);
    return (
      <View
        style={{
          backgroundColor: "#ffffff",
          borderRadius: 20,
          padding: 16,
          marginBottom: 12,
          flexDirection: "row",
          elevation: 2,
          shadowColor: "#000",
          shadowOpacity: 0.05,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: `${color}33`, // soft tinted fill
            borderWidth: 1.5,
            borderColor: `${color}88`,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 14,
          }}
        >
          <WarningTriangleIcon size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "700",
              color: "#111827",
              lineHeight: 20,
            }}
          >
            {recommendation.title}
          </Text>
          <Text
            style={{
              fontSize: 12.5,
              color: "#6b7280",
              marginTop: 6,
              lineHeight: 18,
            }}
          >
            {recommendation.description}
          </Text>
        </View>
      </View>
    );
  },
);

RecommendationCard.displayName = "RecommendationCard";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION WRAPPER — "✨ Rekomendasi" header + list, matching the reference
// ─────────────────────────────────────────────────────────────────────────────
interface RecommendationSectionProps {
  recommendations: Recommendation[];
}

export const RecommendationSection = React.memo(
  ({ recommendations }: RecommendationSectionProps) => {
    return (
      <View
        style={{
          backgroundColor: "#eef1e3",
          borderRadius: 20,
          padding: 16,
          marginHorizontal: 16,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Text style={{ fontSize: 16, marginRight: 6 }}>✨</Text>
          <Text style={{ fontSize: 17, fontWeight: "700", color: "#111827" }}>
            Rekomendasi
          </Text>
        </View>
        {recommendations.map((rec) => (
          <RecommendationCard key={rec.id} recommendation={rec} />
        ))}
      </View>
    );
  },
);

RecommendationSection.displayName = "RecommendationSection";
