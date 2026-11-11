import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Path, Svg } from "react-native-svg";

interface HeartbeatChartProps {
  width: number;
  height: number;
  bpm: number;
}

const CHART_H = 52;
const BASELINE_RATIO = 0.6;
const MAX_POINTS = 200;

function buildPulseSamples(rPeakH: number, count: number): number[] {
  const baseline = CHART_H * BASELINE_RATIO;
  const pts: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let y = baseline;
    if (t >= 0.08 && t < 0.18) {
      y = baseline - Math.sin(((t - 0.08) / 0.1) * Math.PI) * rPeakH * 0.18;
    } else if (t >= 0.28 && t < 0.33) {
      y = baseline + Math.sin(((t - 0.28) / 0.05) * Math.PI) * rPeakH * 0.12;
    } else if (t >= 0.33 && t < 0.38) {
      y = baseline - Math.sin(((t - 0.33) / 0.05) * Math.PI) * rPeakH;
    } else if (t >= 0.38 && t < 0.44) {
      y = baseline + Math.sin(((t - 0.38) / 0.06) * Math.PI) * rPeakH * 0.22;
    } else if (t >= 0.54 && t < 0.72) {
      y = baseline - Math.sin(((t - 0.54) / 0.18) * Math.PI) * rPeakH * 0.32;
    }
    pts.push(y);
  }
  return pts;
}

function samplesToPath(samples: number[], width: number): string {
  if (samples.length < 2) return "";
  const step = width / (samples.length - 1);
  let d = `M 0 ${samples[0].toFixed(2)}`;
  for (let i = 1; i < samples.length; i++) {
    d += ` L ${(i * step).toFixed(2)} ${samples[i].toFixed(2)}`;
  }
  return d;
}

export const HeartbeatChart = React.memo(
  ({ width, bpm }: HeartbeatChartProps) => {
    const baseline = CHART_H * BASELINE_RATIO;
    const bufferRef = useRef<number[]>(Array(MAX_POINTS).fill(baseline));
    const [pathD, setPathD] = useState("");

    useEffect(() => {
      const samplesPerPulse = Math.round(MAX_POINTS * 0.55);
      const rPeakH = 14 + Math.min(1, Math.max(0, (bpm - 55) / 75)) * 8;

      const interval = setInterval(() => {
        const pulse = buildPulseSamples(rPeakH, samplesPerPulse);
        const newBuf = [...bufferRef.current.slice(samplesPerPulse), ...pulse];
        bufferRef.current = newBuf;
        setPathD(samplesToPath(newBuf, width));
      }, 1000);

      return () => clearInterval(interval);
    }, [bpm, width]);

    return (
      <View style={{ width, height: CHART_H, overflow: "hidden" }}>
        <Svg width={width} height={CHART_H}>
          <Path
            d={`M 0 ${baseline} L ${width} ${baseline}`}
            stroke="#fca5a5"
            strokeWidth={0.5}
            strokeOpacity={0.5}
            strokeDasharray="4 4"
            fill="none"
          />
          {pathD !== "" && (
            <Path
              d={pathD}
              stroke="#ef4444"
              strokeWidth={1.8}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
      </View>
    );
  },
);

HeartbeatChart.displayName = "HeartbeatChart";
