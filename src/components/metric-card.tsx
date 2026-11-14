import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Line, Path, Svg, Text as SvgText } from "react-native-svg";

interface MetricCardProps {
  bpmHistory?: number[];
  spo2?: number;
  heartRate?: number;
  onPressSpo2?: () => void;
  onPressHr?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR HELPERS
// ─────────────────────────────────────────────────────────────────────────────
// Pastel/bright palette — keeps urgency gradient but stays soft, not muddy
const SPO2_COLOR_STOPS = [
  { v: 80, r: 255, g: 138, b: 148 }, // pastel red (critical)
  { v: 84, r: 255, g: 154, b: 139 }, // pastel coral
  { v: 89, r: 255, g: 196, b: 130 }, // pastel orange
  { v: 94, r: 190, g: 224, b: 150 }, // pastel lime
  { v: 100, r: 142, g: 222, b: 189 }, // pastel mint green
];
function lerpSpo2Color(spo2: number) {
  const clamped = Math.min(100, Math.max(80, spo2));
  for (let i = 0; i < SPO2_COLOR_STOPS.length - 1; i++) {
    const a = SPO2_COLOR_STOPS[i];
    const b = SPO2_COLOR_STOPS[i + 1];
    if (clamped <= b.v) {
      const t = (clamped - a.v) / (b.v - a.v);
      return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t),
      };
    }
  }
  return SPO2_COLOR_STOPS[SPO2_COLOR_STOPS.length - 1];
}
function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return (
    "#" +
    [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
  );
}
function getSpo2Label(v: number) {
  if (v >= 95) return "Normal";
  if (v >= 90) return "Hipoksemia Ringan";
  if (v >= 85) return "Hipoksemia Sedang";
  if (v >= 80) return "Hipoksemia Berat";
  return "Kritis";
}
function getHrLabel(v: number) {
  if (v < 60) return "Bradikardi";
  if (v <= 100) return "Normal";
  if (v <= 120) return "Takikardi Ringan";
  return "Takikardi";
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED: outer white card shell (icon bubble + title + inner colored container)
// ─────────────────────────────────────────────────────────────────────────────
function CardShell({
  icon,
  title,
  iconBg,
  children,
  width,
  height,
}: {
  icon: React.ReactNode;
  title: string;
  iconBg: string;
  children: React.ReactNode;
  width: number;
  height: number;
}) {
  return (
    <View
      style={{
        width,
        borderRadius: 22,
        backgroundColor: "#ffffff",
        padding: 8,
        elevation: 3,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      {/* header: icon bubble + title */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 6,
          paddingHorizontal: 2,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: iconBg,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 8,
          }}
        >
          {icon}
        </View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: "#1f2937" }}>
          {title}
        </Text>
      </View>

      {/* inner colored container */}
      <View
        style={{
          height,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIQUID CARD (inner content only — the colored water container)
// ─────────────────────────────────────────────────────────────────────────────
const WATER_TOP_RATIO = 0.12;
const LiquidCard = React.memo(
  ({
    spo2,
    cardW,
    cardH,
  }: {
    spo2: number;
    cardW: number;
    cardH: number;
  }) => {
    const fillAnim = useRef(new Animated.Value(spo2)).current;
    const waveOffset = useRef(new Animated.Value(0)).current;
    const colorAnim = useRef(new Animated.Value((spo2 - 80) / 20)).current;
    const waterTopY = cardH * WATER_TOP_RATIO;
    const calcFillY = (v: number) =>
      waterTopY +
      (1 - Math.min(1, Math.max(0, (v - 80) / 20))) * (cardH - waterTopY);
    const [fillY, setFillY] = useState(() => calcFillY(spo2));
    const [waveX, setWaveX] = useState(0);
    const buildColors = (v: number) => {
      const c = lerpSpo2Color(v);
      return {
        deep: rgbToHex(c),
        mid: rgbToHex({
          r: Math.min(255, c.r + 22),
          g: Math.min(255, c.g + 22),
          b: Math.min(255, c.b + 22),
        }),
        bg: rgbToHex({
          r: Math.min(255, c.r + 45),
          g: Math.min(255, c.g + 45),
          b: Math.min(255, c.b + 45),
        }),
        text: rgbToHex({
          r: Math.max(0, c.r - 90),
          g: Math.max(0, c.g - 90),
          b: Math.max(0, c.b - 90),
        }),
      };
    };
    const init = buildColors(spo2);
    const [deepColor, setDeepColor] = useState(init.deep);
    const [midColor, setMidColor] = useState(init.mid);
    const [bgColor, setBgColor] = useState(init.bg);
    const [textColor, setTextColor] = useState(init.text);
    useEffect(() => {
      const id = fillAnim.addListener(({ value }) =>
        setFillY(calcFillY(value)),
      );
      return () => fillAnim.removeListener(id);
    }, [cardH]);
    useEffect(() => {
      const id = colorAnim.addListener(({ value }) => {
        const cols = buildColors(80 + value * 20);
        setDeepColor(cols.deep);
        setMidColor(cols.mid);
        setBgColor(cols.bg);
        setTextColor(cols.text);
      });
      return () => colorAnim.removeListener(id);
    }, []);
    useEffect(() => {
      const loop = Animated.loop(
        Animated.timing(waveOffset, {
          toValue: -cardW,
          duration: 2600,
          easing: Easing.linear,
          useNativeDriver: false,
        }),
      );
      loop.start();
      const id = waveOffset.addListener(({ value }) =>
        setWaveX(-(((value % cardW) + cardW) % cardW)),
      );
      return () => {
        loop.stop();
        waveOffset.removeListener(id);
      };
    }, [cardW]);
    useEffect(() => {
      Animated.spring(fillAnim, {
        toValue: spo2,
        damping: 20,
        stiffness: 50,
        mass: 1.2,
        useNativeDriver: false,
      }).start();
      Animated.spring(colorAnim, {
        toValue: (spo2 - 80) / 20,
        damping: 18,
        stiffness: 40,
        useNativeDriver: false,
      }).start();
    }, [spo2]);
    function buildWavePath(
      totalW: number,
      h: number,
      yBase: number,
      waveH: number,
      offsetX: number,
    ): string {
      const cycleW = cardW * 0.9;
      const segs = Math.ceil(totalW / cycleW) + 3;
      let d = `M ${offsetX} ${yBase}`;
      for (let i = 0; i < segs; i++) {
        const x0 = offsetX + i * cycleW;
        d += ` C ${x0 + cycleW * 0.25} ${yBase - waveH}, ${x0 + cycleW * 0.75} ${yBase + waveH}, ${x0 + cycleW} ${yBase}`;
      }
      d += ` L ${offsetX + segs * cycleW} ${h + 10} L ${offsetX} ${h + 10} Z`;
      return d;
    }
    const waveH = cardH * 0.03;
    const totalW = cardW * 3;
    return (
      <View
        style={{
          width: cardW,
          height: cardH,
          backgroundColor: bgColor,
        }}
      >
        <Svg
          style={{ position: "absolute", top: 0, left: 0 }}
          width={cardW}
          height={cardH}
        >
          <Path
            d={buildWavePath(
              totalW,
              cardH,
              fillY,
              waveH * 1.5,
              waveX - cardW * 0.4,
            )}
            fill={midColor}
            fillOpacity={0.45}
          />
        </Svg>
        <Svg
          style={{ position: "absolute", top: 0, left: 0 }}
          width={cardW}
          height={cardH}
        >
          <Path
            d={buildWavePath(totalW, cardH, fillY, waveH, waveX)}
            fill={deepColor}
            fillOpacity={0.85}
          />
        </Svg>
        <View style={{ position: "absolute", bottom: 10, left: 12, right: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <Text
              style={{
                fontSize: 34,
                fontWeight: "700",
                color: "#111827",
                lineHeight: 38,
              }}
            >
              {spo2}
            </Text>
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                color: "#111827",
                marginBottom: 4,
                marginLeft: 2,
                opacity: 0.7,
              }}
            >
              %
            </Text>
          </View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: textColor,
              marginTop: 2,
            }}
          >
            {getSpo2Label(spo2)}
          </Text>
        </View>
      </View>
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// BPM TREND CHART — line chart of per-minute readings, fills full card height
// ─────────────────────────────────────────────────────────────────────────────
const MAX_TREND_POINTS = 12; // last 12 minutes

function bpmToY(bpm: number, height: number, minBpm: number, maxBpm: number) {
  const clamped = Math.min(maxBpm, Math.max(minBpm, bpm));
  const t = (clamped - minBpm) / (maxBpm - minBpm || 1);
  const pad = height * 0.12;
  return height - pad - t * (height - pad * 2);
}

function buildTrendPath(
  values: number[],
  width: number,
  height: number,
): { line: string; area: string } {
  if (values.length === 0) return { line: "", area: "" };
  const minBpm = 50;
  const maxBpm = 140;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({
    x: values.length > 1 ? i * step : width,
    y: bpmToY(v, height, minBpm, maxBpm),
  }));
  let line = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const midX = (prev.x + cur.x) / 2;
    line += ` C ${midX.toFixed(2)} ${prev.y.toFixed(2)}, ${midX.toFixed(2)} ${cur.y.toFixed(2)}, ${cur.x.toFixed(2)} ${cur.y.toFixed(2)}`;
  }
  const area =
    line +
    ` L ${pts[pts.length - 1].x.toFixed(2)} ${height} L ${pts[0].x.toFixed(2)} ${height} Z`;
  return { line, area };
}

const BpmTrendChart = React.memo(
  ({
    width,
    height,
    history,
  }: {
    width: number;
    height: number;
    history: number[];
  }) => {
    const { line, area } = buildTrendPath(history, width, height);
    return (
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
        }}
      >
        <Svg width={width} height={height}>
          {area !== "" && <Path d={area} fill="#dc2626" fillOpacity={0.12} />}
          {line !== "" && (
            <Path
              d={line}
              stroke="#dc2626"
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.5}
            />
          )}
        </Svg>
      </View>
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// HEARTBEAT CHART — EKG scrolling animasi, update tiap 1 detik
// ─────────────────────────────────────────────────────────────────────────────
const EKG_H = 52;
const EKG_BASELINE = EKG_H * 0.6;
const MAX_POINTS = 200;

function buildPulseSamples(rPeakH: number, count: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let y = EKG_BASELINE;
    if (t >= 0.08 && t < 0.18) {
      y = EKG_BASELINE - Math.sin(((t - 0.08) / 0.1) * Math.PI) * rPeakH * 0.18;
    } else if (t >= 0.28 && t < 0.33) {
      y =
        EKG_BASELINE + Math.sin(((t - 0.28) / 0.05) * Math.PI) * rPeakH * 0.12;
    } else if (t >= 0.33 && t < 0.38) {
      y = EKG_BASELINE - Math.sin(((t - 0.33) / 0.05) * Math.PI) * rPeakH;
    } else if (t >= 0.38 && t < 0.44) {
      y =
        EKG_BASELINE + Math.sin(((t - 0.38) / 0.06) * Math.PI) * rPeakH * 0.22;
    } else if (t >= 0.54 && t < 0.72) {
      y =
        EKG_BASELINE - Math.sin(((t - 0.54) / 0.18) * Math.PI) * rPeakH * 0.32;
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

const HeartbeatChart = React.memo(
  ({ width, bpm }: { width: number; bpm: number }) => {
    const bufferRef = useRef<number[]>(Array(MAX_POINTS).fill(EKG_BASELINE));
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
      <View style={{ width, height: EKG_H, overflow: "hidden" }}>
        <Svg width={width} height={EKG_H}>
          <Path
            d={`M 0 ${EKG_BASELINE} L ${width} ${EKG_BASELINE}`}
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

// ─────────────────────────────────────────────────────────────────────────────
// EKG SPARKLINE (HeartSparkline) — tetap sama seperti aslinya
// ─────────────────────────────────────────────────────────────────────────────
const EKG_MID = EKG_H * 0.58;
const MAX_PULSES = 10;

interface PulseRecord {
  id: number;
  bpm: number;
}

const HeartSparkline = React.memo(
  ({
    bpm,
    triggerCount,
    width,
  }: {
    bpm: number;
    triggerCount: number;
    width: number;
  }) => {
    const [pulseHistory, setPulseHistory] = useState<PulseRecord[]>([]);
    const [crosshairX, setCrosshairX] = useState<number | null>(null);
    const [tooltipBpm, setTooltipBpm] = useState<number | null>(null);
    const shiftAnim = useRef(new Animated.Value(0)).current;
    const [shiftX, setShiftX] = useState(0);
    const prevTrigger = useRef(triggerCount);
    const SLOT_W = width / MAX_PULSES;

    useEffect(() => {
      const id = shiftAnim.addListener(({ value }) => setShiftX(value));
      return () => shiftAnim.removeListener(id);
    }, [shiftAnim]);

    const getRPeakH = (value: number) => {
      const t = Math.min(1, Math.max(0, (value - 55) / 75));
      return 22 - t * 8;
    };

    const buildPulse = (bpmValue: number, x: number) => {
      const beatW = SLOT_W * 0.88;
      const rH = getRPeakH(bpmValue);
      const rPeak = EKG_MID - rH;
      const sNeg = EKG_MID + rH * 0.2;
      const pAmp = rH * 0.18;
      const tAmp = rH * 0.3;
      let d = `M ${x} ${EKG_MID}`;
      d += ` L ${x + beatW * 0.1} ${EKG_MID}`;
      d += ` C ${x + beatW * 0.18} ${EKG_MID - pAmp}, ${x + beatW * 0.24} ${EKG_MID - pAmp}, ${x + beatW * 0.3} ${EKG_MID}`;
      d += ` L ${x + beatW * 0.42} ${EKG_MID}`;
      d += ` L ${x + beatW * 0.46} ${EKG_MID + rH * 0.1}`;
      d += ` L ${x + beatW * 0.5} ${rPeak}`;
      d += ` L ${x + beatW * 0.54} ${sNeg}`;
      d += ` L ${x + beatW * 0.6} ${EKG_MID}`;
      d += ` L ${x + beatW * 0.68} ${EKG_MID}`;
      d += ` C ${x + beatW * 0.76} ${EKG_MID - tAmp}, ${x + beatW * 0.84} ${EKG_MID - tAmp}, ${x + beatW * 0.92} ${EKG_MID}`;
      d += ` L ${x + beatW} ${EKG_MID}`;
      return d;
    };

    useEffect(() => {
      if (triggerCount === prevTrigger.current) return;
      prevTrigger.current = triggerCount;
      setPulseHistory((prev): PulseRecord[] => {
        const next = [...prev, { id: Date.now() + Math.random(), bpm }];
        if (next.length > MAX_PULSES) next.shift();
        return next;
      });
      shiftAnim.setValue(SLOT_W);
      Animated.timing(shiftAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    }, [triggerCount, bpm, SLOT_W, shiftAnim]);

    const findNearest = useCallback(
      (touchX: number): { x: number; bpm: number } | null => {
        if (pulseHistory.length === 0) return null;
        let nearest: { x: number; bpm: number } | null = null;
        let nearestDist = Infinity;
        pulseHistory.forEach((pulse, index) => {
          const x =
            width -
            pulseHistory.length * SLOT_W +
            index * SLOT_W +
            SLOT_W * 0.5 +
            shiftX;
          const dist = Math.abs(touchX - x);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = { x, bpm: pulse.bpm };
          }
        });
        return nearest;
      },
      [pulseHistory, SLOT_W, width, shiftX],
    );

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const r = findNearest(e.nativeEvent.locationX);
          if (!r) return;
          setCrosshairX(r.x);
          setTooltipBpm(r.bpm);
        },
        onPanResponderMove: (e) => {
          const r = findNearest(e.nativeEvent.locationX);
          if (!r) return;
          setCrosshairX(r.x);
          setTooltipBpm(r.bpm);
        },
        onPanResponderRelease: () => {
          setTimeout(() => {
            setCrosshairX(null);
            setTooltipBpm(null);
          }, 1200);
        },
      }),
    ).current;

    return (
      <View
        style={{ width, height: EKG_H, overflow: "hidden" }}
        {...panResponder.panHandlers}
      >
        <Svg width={width} height={EKG_H}>
          {pulseHistory.map((pulse, index) => {
            const x =
              width - pulseHistory.length * SLOT_W + index * SLOT_W + shiftX;
            const opacity =
              0.2 + (index / Math.max(1, pulseHistory.length - 1)) * 0.8;
            return (
              <Path
                key={pulse.id}
                d={buildPulse(pulse.bpm, x)}
                stroke="#38bdf8"
                strokeWidth={1.8}
                strokeOpacity={opacity}
                fill="none"
              />
            );
          })}
        </Svg>
        {crosshairX !== null && tooltipBpm !== null && (
          <Svg style={{ position: "absolute" }} width={width} height={EKG_H}>
            <Line
              x1={crosshairX}
              y1={0}
              x2={crosshairX}
              y2={EKG_H}
              stroke="#64748b"
              strokeWidth={1}
            />
            <SvgText
              x={crosshairX}
              y={12}
              fontSize={11}
              fontWeight="700"
              fill="#0c4a6e"
              textAnchor="middle"
            >
              {tooltipBpm} bpm
            </SvgText>
          </Svg>
        )}
      </View>
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// HEART RATE INNER CONTAINER
// ─────────────────────────────────────────────────────────────────────────────
const HeartRateInner = React.memo(
  ({
    heartRateDisplay,
    innerW,
    innerH,
    bpmHistory,
  }: {
    heartRateDisplay: number;
    innerW: number;
    innerH: number;
    bpmHistory: number[];
  }) => {
    return (
      <View
        style={{
          width: innerW,
          height: innerH,
          backgroundColor: "#fff1f2",
        }}
      >
        {/* layer 1: trend chart, background, full height */}
        <BpmTrendChart width={innerW} height={innerH} history={bpmHistory} />

        {/* layer 2: soft frosted overlay to separate chart from info */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: innerH * 0.42,
            backgroundColor: "#fff1f2",
            opacity: 0.75,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: innerH * 0.42 - 1,
            height: 16,
            backgroundColor: "#fff1f2",
            opacity: 0.35,
          }}
        />

        {/* layer 3: info on top */}
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
            <Text
              style={{
                fontSize: 34,
                fontWeight: "700",
                color: "#111827",
                lineHeight: 38,
              }}
            >
              {heartRateDisplay}
            </Text>
            <Text
              style={{
                fontSize: 13,
                fontWeight: "500",
                color: "#374151",
                marginBottom: 4,
                marginLeft: 3,
                opacity: 0.7,
              }}
            >
              bpm
            </Text>
          </View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: "#dc2626",
              marginTop: 2,
            }}
          >
            {getHrLabel(heartRateDisplay)}
          </Text>
        </View>
      </View>
    );
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATED DATA
// ─────────────────────────────────────────────────────────────────────────────
function useSimulatedData(externalSpo2?: number, externalBpm?: number) {
  const [spo2Display, setSpo2Display] = useState(97);
  const [heartRateDisplay, setHeartRateDisplay] = useState(72);
  const [bpmHistory, setBpmHistory] = useState<number[]>([72, 72]);
  const latestReadingRef = useRef(72);

  useEffect(() => {
    if (externalSpo2 !== undefined) return;
    const t = setInterval(() => {
      setSpo2Display((p) =>
        Math.min(100, Math.max(80, p + Math.round(Math.random() * 4) - 2)),
      );
    }, 3000);
    return () => clearInterval(t);
  }, [externalSpo2]);

  // reading dilakukan tiap 20 detik
  useEffect(() => {
    if (externalBpm !== undefined) return;
    const readTimer = setInterval(() => {
      latestReadingRef.current = Math.min(
        130,
        Math.max(
          55,
          latestReadingRef.current + Math.round(Math.random() * 10) - 5,
        ),
      );
      setHeartRateDisplay(latestReadingRef.current);
    }, 20000);
    return () => clearInterval(readTimer);
  }, [externalBpm]);

  // chart di-update tiap 1 menit, pakai pembacaan terakhir
  useEffect(() => {
    if (externalBpm !== undefined) return;
    const chartTimer = setInterval(() => {
      setBpmHistory((prev) => {
        const next = [...prev, latestReadingRef.current];
        if (next.length > MAX_TREND_POINTS) next.shift();
        return next;
      });
    }, 60000);
    return () => clearInterval(chartTimer);
  }, [externalBpm]);

  return {
    spo2Display: externalSpo2 ?? spo2Display,
    heartRateDisplay: externalBpm ?? heartRateDisplay,
    bpmHistory,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export const MetricCard = React.memo(
  ({ spo2, heartRate }: MetricCardProps) => {
    const { width: screenW } = useWindowDimensions();
    const cardW = screenW - 32;
    const GAP = 10;
    const { spo2Display, heartRateDisplay, bpmHistory } = useSimulatedData(
      spo2,
      heartRate,
    );
    const outerW = Math.floor((cardW - GAP) / 2);
    const INNER_H = 150;
    const innerContentW = outerW - 16; // minus shell padding (8 left + 8 right)

    return (
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: "row", gap: GAP }}>
          {/* ── Card Detak Jantung ── */}
          <CardShell
            icon={<Text style={{ fontSize: 14 }}>❤️</Text>}
            title="Detak Jantung"
            iconBg="#f3f4f6"
            width={outerW}
            height={INNER_H}
          >
            <HeartRateInner
              heartRateDisplay={heartRateDisplay}
              innerW={innerContentW}
              innerH={INNER_H}
              bpmHistory={bpmHistory}
            />
          </CardShell>

          {/* ── Card SpO2 ── */}
          <CardShell
            icon={<Text style={{ fontSize: 14 }}>❤️</Text>}
            title="SPO2"
            iconBg="#f3f4f6"
            width={outerW}
            height={INNER_H}
          >
            <LiquidCard
              spo2={spo2Display}
              cardW={innerContentW}
              cardH={INNER_H}
            />
          </CardShell>
        </View>
      </View>
    );
  },
);

MetricCard.displayName = "MetricCard";
