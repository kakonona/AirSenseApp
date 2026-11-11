import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Path, Svg } from "react-native-svg";

interface PollutantReading {
  label: string; // e.g. "PM2.5"
  value: number;
  unit: string; // e.g. "µg/m³"
  color: string; // dot color
}

interface AirQualityScoreProps {
  score?: number;
  date?: string;
  pollutants?: PollutantReading[];
  onPressArrow?: () => void;
}

const DEFAULT_POLLUTANTS: PollutantReading[] = [
  { label: "PM2.5", value: 39.2, unit: "µg/m³", color: "#F0BD8C" },
  { label: "PM10", value: 101.34, unit: "µg/m³", color: "#F5E08C" },
  { label: "CO", value: 0.49, unit: "µg/m³", color: "#A8D3B9" },
];

// Continuous color stops across 0–500, pastel palette following
// the standard AQI breakpoints (0-50 green, 51-100 yellow, 101-150
// orange, 151-200 red, 201-300 purple, 301+ maroon) — smooth gradient
// between each stop, not a hard cutoff.
const COLOR_STOPS: { aqi: number; r: number; g: number; b: number }[] = [
  { aqi: 0, r: 168, g: 211, b: 185 }, // #A8D3B9 pastel hijau — Baik
  { aqi: 50, r: 168, g: 211, b: 185 },
  { aqi: 100, r: 240, g: 222, b: 150 }, // pastel kuning — Sedang
  { aqi: 150, r: 236, g: 191, b: 145 }, // pastel oranye — Tdk Sehat Sensitif
  { aqi: 200, r: 224, g: 148, b: 140 }, // pastel merah — Tidak Sehat
  { aqi: 300, r: 189, g: 150, b: 196 }, // pastel ungu — Sangat Tidak Sehat
  { aqi: 500, r: 163, g: 110, b: 110 }, // pastel maroon — Berbahaya
];

function lerpColor(aqi: number): { r: number; g: number; b: number } {
  const clamped = Math.min(500, Math.max(0, aqi));
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (clamped <= b.aqi) {
      const t = (clamped - a.aqi) / (b.aqi - a.aqi);
      return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
      };
    }
  }
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  return { r: last.r, g: last.g, b: last.b };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0"))
      .join("")
  );
}

const AQI_LEVELS = [
  { max: 50, label: "Baik", color: "#7FB88F" },
  { max: 100, label: "Sedang", color: "#C9A227" },
  { max: 150, label: "Tidak Sehat utk Sensitif", color: "#C97A3D" },
  { max: 200, label: "Tidak Sehat", color: "#C15C55" },
  { max: 300, label: "Sangat Tidak Sehat", color: "#8E5FA3" },
  { max: Infinity, label: "Berbahaya", color: "#7A4A4A" },
];

function getLevel(s: number): { label: string; color: string } {
  return (
    AQI_LEVELS.find((lvl) => s <= lvl.max) ?? AQI_LEVELS[AQI_LEVELS.length - 1]
  );
}

// point on an ellipse (elongated arc), given center, radii, angle
function ellipticalXY(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angleDeg: number,
) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

// ---- Arc gauge: elongated half-circle, 180deg span (left to right, opening down) ----
const CornerArrowButton = ({ onPress }: { onPress?: () => void }) => (
  <Pressable
    onPress={onPress}
    hitSlop={8}
    style={{
      position: "absolute",
      bottom: 0,
      right: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: "rgba(0,0,0,0.85)",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>↗</Text>
  </Pressable>
);

export const AirQualityScore = React.memo(
  ({
    score: externalScore,
    date = "Senin, 25 Mei 2026",
    pollutants = DEFAULT_POLLUTANTS,
    onPressArrow,
  }: AirQualityScoreProps) => {
    const animatedScore = useRef(new Animated.Value(110)).current;
    const [displayScore, setDisplayScore] = useState(110);
    const targetScore = useRef(110);

    const { width: screenW } = useWindowDimensions();

    useEffect(() => {
      const id = animatedScore.addListener(({ value }) => {
        setDisplayScore(value);
      });
      return () => animatedScore.removeListener(id);
    }, [animatedScore]);

    useEffect(() => {
      if (externalScore !== undefined) return;
      const interval = setInterval(() => {
        const delta = Math.floor(Math.random() * 31) - 15;
        const next = Math.min(500, Math.max(0, targetScore.current + delta));
        targetScore.current = next;
        Animated.spring(animatedScore, {
          toValue: next,
          useNativeDriver: false,
          damping: 18,
          stiffness: 120,
          mass: 1,
        }).start();
      }, 1000);
      return () => clearInterval(interval);
    }, [animatedScore, externalScore]);

    const score = externalScore ?? displayScore;

    const cardW = screenW - 32;
    // elongated half-circle: wider than tall
    const ARC_W = Math.min(cardW - 16, 380);
    const ARC_H = ARC_W * 0.52;
    const SW = ARC_W * 0.115; // stroke width — thicker arc
    const cx = ARC_W / 2;
    const cy = ARC_H + SW / 2; // baseline sits at bottom of the arc box, minus stroke padding
    const rx = ARC_W / 2 - SW / 2;
    const ry = ARC_H - SW / 2;

    // 180deg span: from 180deg (left) to 360deg (right), opening downward
    const START_DEG = 190;
    const END_DEG = 350;
    const totalSpan = END_DEG - START_DEG;

    const frac = Math.min(1, Math.max(0, score / 500));
    const progSpan = frac * totalSpan;

    const colorAtScore = lerpColor(score);
    const colorHex = toHex(colorAtScore);

    // progress arc as many small overlapping segments — smooth per-pixel
    // gradient that actually follows the curve (unlike a linear SVG
    // gradient, which draws straight across and looks wrong on a bend).
    // Segments intentionally overlap by a hair so there's never a gap,
    // and every segment uses a flat "butt" cap so nothing stacks into a
    // solid dot — only the two outermost tips get a round cap.
    const ARC_SEGMENTS = 100;
    const progressSegs: { path: string; color: string }[] = [];
    if (frac > 0.004) {
      const segCount = Math.max(1, Math.ceil(ARC_SEGMENTS * frac));
      const overlapDeg = totalSpan * 0.001; // small overlap: keeps seams closed under the round caps
      for (let i = 0; i < segCount; i++) {
        const t0 = (i / segCount) * frac;
        const t1 = ((i + 1) / segCount) * frac;
        const deg0 = START_DEG + t0 * totalSpan - (i === 0 ? 0 : overlapDeg);
        const deg1 =
          START_DEG + t1 * totalSpan + (i === segCount - 1 ? 0 : overlapDeg);
        const p0 = ellipticalXY(cx, cy, rx, ry, deg0);
        const p1 = ellipticalXY(cx, cy, rx, ry, deg1);
        const midT = (t0 + t1) / 2;
        const aqiAtMid = frac > 0 ? (midT / frac) * score : 0;
        progressSegs.push({
          path: `M ${p0.x} ${p0.y} A ${rx} ${ry} 0 0 1 ${p1.x} ${p1.y}`,
          color: toHex(lerpColor(aqiAtMid)),
        });
      }
    }
    const progEndDeg = START_DEG + progSpan;
    const progStart = ellipticalXY(cx, cy, rx, ry, START_DEG);
    const progEnd = ellipticalXY(cx, cy, rx, ry, progEndDeg);

    // remaining (track) arc, single flat gray path
    const trackStart = ellipticalXY(cx, cy, rx, ry, START_DEG + progSpan);
    const trackEnd = ellipticalXY(cx, cy, rx, ry, END_DEG);
    const trackLargeArc = totalSpan - progSpan > 180 ? 1 : 0;
    const trackPath =
      frac < 1
        ? `M ${trackStart.x} ${trackStart.y} A ${rx} ${ry} 0 ${trackLargeArc} 1 ${trackEnd.x} ${trackEnd.y}`
        : "";

    const level = getLevel(score);

    return (
      <View style={{ paddingHorizontal: 16 }}>
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 24,
            paddingVertical: 12,
            paddingHorizontal: 12,
            width: "100%",
            elevation: 3,
            shadowColor: "#000",
            shadowOpacity: 0.06,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          <Text
            style={{
              fontSize: 19,
              fontWeight: "700",
              color: "#111827",
              marginBottom: 1,
            }}
          >
            Kualitas udara saat ini
          </Text>
          <Text style={{ fontSize: 12, color: "#9ca3af", marginBottom: 2 }}>
            {date}
          </Text>

          <View
            style={{
              width: ARC_W,
              height: ARC_H + SW,
              alignSelf: "center",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <Svg
              width={ARC_W}
              height={ARC_H + SW}
              style={{ position: "absolute", top: 0 }}
            >
              {/* track (remaining) arc, drawn first so progress sits above it */}
              {trackPath !== "" && (
                <Path
                  d={trackPath}
                  stroke="#dfe2e6"
                  strokeWidth={SW}
                  fill="none"
                  strokeLinecap="round"
                />
              )}
              {/* progress arc, many overlapping segments for a smooth
                    curve-following gradient. Every segment is short and
                    round-capped so segments blend into each other with no
                    gaps and no single point stacks up into a visible dot. */}
              {progressSegs.map((seg, i) => (
                <Path
                  key={i}
                  d={seg.path}
                  stroke={seg.color}
                  strokeWidth={SW}
                  fill="none"
                  strokeLinecap="round"
                />
              ))}
            </Svg>

            {/* center content */}
            <View style={{ alignItems: "center", marginBottom: ARC_H * 0.15 }}>
              <Text
                style={{
                  fontSize: ARC_W * 0.22,
                  fontWeight: "700",
                  color: "#111827",
                  lineHeight: ARC_W * 0.23,
                }}
              >
                {Math.round(score)}
              </Text>
              <Text style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                AQI⁺
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: level.color,
                  marginTop: 2,
                }}
              >
                {level.label}
              </Text>
            </View>
          </View>

          {/* pollutant badges row + arrow, all inline together */}
          <View
            style={{
              flexDirection: "row",
              marginTop: -20,
              gap: 6,
              justifyContent: "center",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {pollutants.map((p) => (
              <View
                key={p.label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#f7f8f9",
                  borderRadius: 20,
                  paddingVertical: 5,
                  paddingRight: 10,
                  paddingLeft: 5,
                }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: p.color,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: p.label.length > 2 ? 8.5 : 10,
                      fontWeight: "700",
                      color: "#ffffff",
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {p.label}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: "#374151",
                  }}
                  numberOfLines={1}
                >
                  {p.value} {p.unit}
                </Text>
              </View>
            ))}

            {/* arrow button, same row, same height as badges */}
            <Pressable
              onPress={onPressArrow}
              hitSlop={8}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "rgba(0,0,0,0.85)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
                ↗
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  },
);
AirQualityScore.displayName = "AirQualityScore";
