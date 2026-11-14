import BottomNavbar from "@/components/navbar";
import { ScreenBackground } from "@/components/screen-background";
import { useAuth } from "@/context/auth-context";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import {
  buildOptions,
  fetchHistory,
  type Data,
  type Option,
  type Period,
  type Series,
} from "@/lib/history-data";
import { flushQueue, subscribePending } from "@/lib/offline-queue";
import { useFocusEffect } from "expo-router";
import { CalendarDays, Check, ChevronDown } from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Circle, Path, Svg } from "react-native-svg";

const PERIOD_OPTIONS: Period[] = ["Hari", "Minggu", "Bulan", "Tahun", "Semua"];

const RESOLUTION: Record<Period, string> = {
  Hari: "", // per siklus ukur: tanpa keterangan
  Minggu: "per hari",
  Bulan: "per hari",
  Tahun: "per bulan",
  Semua: "per tahun",
};
const BARS_PER_PAGE: Record<Period, number> = {
  Hari: 6,
  Minggu: 7,
  Bulan: 7,
  Tahun: 6,
  Semua: 3,
};

function aqiColor(v: number) {
  if (v <= 50) return "#A8D3B9";
  if (v <= 100) return "#F5E08C";
  if (v <= 125) return "#F7BE79";
  if (v <= 150) return "#F09A78";
  return "#E0948C";
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
function PeriodSelector({
  period,
  onSelect,
}: {
  period: Period;
  onSelect: (period: Period) => void;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View
        style={{
          flexDirection: "row",
          padding: 4,
          borderRadius: 18,
          backgroundColor: "rgba(255,255,255,0.8)",
        }}
      >
        {PERIOD_OPTIONS.map((option) => {
          const active = option === period;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                flex: 1,
                minWidth: 0,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 10,
                borderRadius: 14,
                backgroundColor: active ? "#A8D3B9" : "transparent",
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  fontWeight: active ? "700" : "500",
                  color: "#1f2937",
                }}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ChartCard({
  title,
  dropdown,
  innerBg,
  children,
}: {
  title?: string;
  dropdown: string;
  innerBg: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: "#fff",
        borderRadius: 22,
        padding: 8,
        marginBottom: 14,
        elevation: 3,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
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
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: "#f3f4f6",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 8,
          }}
        >
          <Text style={{ fontSize: 13 }}>❤️</Text>
        </View>
        {title ? (
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: "#1f2937",
              marginRight: 8,
            }}
          >
            {title}
          </Text>
        ) : null}
        {dropdown ? (
          <View
            style={{
              backgroundColor: "#f3f4f6",
              borderRadius: 12,
              paddingHorizontal: 10,
              paddingVertical: 3,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: "#374151" }}>
              {dropdown} ⌄
            </Text>
          </View>
        ) : null}
      </View>
      <View
        style={{
          backgroundColor: innerBg,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function ArrowBtn({
  dir,
  disabled,
  onPress,
}: {
  dir: "left" | "right";
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        backgroundColor: "#fff",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <Text
        style={{
          fontSize: 16,
          fontWeight: "700",
          color: "#111827",
          marginTop: -2,
        }}
      >
        {dir === "left" ? "‹" : "›"}
      </Text>
    </Pressable>
  );
}

function DateDropdown({
  period,
  options,
  selIdx,
  onSelect,
}: {
  period: Period;
  options: Option[];
  selIdx: number;
  onSelect: (i: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const current = options[selIdx] ?? options[0];
  const dateLabels: Record<Period, string> = {
    Hari: "TANGGAL",
    Minggu: "MINGGU",
    Bulan: "BULAN",
    Tahun: "TAHUN",
    Semua: "RENTANG DATA",
  };
  const selectHint: Record<Period, string> = {
    Hari: "Pilih tanggal",
    Minggu: "Pilih minggu",
    Bulan: "Pilih bulan",
    Tahun: "Pilih tahun",
    Semua: "Seluruh data yang tersimpan",
  };
  const relativeLabel = (index: number) => {
    if (period === "Hari") {
      if (index === 0) return "Hari ini";
      if (index === 1) return "Kemarin";
      return `${index} hari lalu`;
    }
    if (period === "Minggu") {
      return index === 0 ? "Minggu ini" : `${index} minggu lalu`;
    }
    if (period === "Bulan") {
      return index === 0 ? "Bulan ini" : `${index} bulan lalu`;
    }
    return index === 0 ? "Tahun ini" : `${index} tahun lalu`;
  };

  return (
    <View style={{ marginBottom: 18 }}>
      <Text
        style={{
          marginBottom: 8,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.8,
          color: "#6b7280",
        }}
      >
        {dateLabels[period]}
      </Text>
      <Pressable
        onPress={() => period !== "Semua" && setOpen((value) => !value)}
        disabled={period === "Semua"}
        accessibilityRole="button"
        accessibilityLabel={`${dateLabels[period]}: ${current.label}`}
        accessibilityState={{ expanded: open, disabled: period === "Semua" }}
        style={{
          minHeight: 70,
          flexDirection: "row",
          alignItems: "center",
          padding: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: open ? "#A8D3B9" : "#e5e7eb",
          backgroundColor: "#fff",
          opacity: period === "Semua" ? 0.9 : 1,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#F3F4F6",
            marginRight: 12,
          }}
        >
          <CalendarDays size={20} color="#47775B" strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: "700", color: "#1f2937" }}
          >
            {current.label}
          </Text>
          <Text style={{ marginTop: 3, fontSize: 12, color: "#6b7280" }}>
            {selectHint[period]}
          </Text>
        </View>
        {period !== "Semua" ? (
          <ChevronDown
            size={20}
            color="#6b7280"
            style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
          />
        ) : null}
      </Pressable>

      {open && (
        <View
          style={{
            marginTop: 8,
            backgroundColor: "#fff",
            borderRadius: 18,
            borderWidth: 1,
            borderColor: "#edf0ed",
            padding: 8,
            maxHeight: 200,
            elevation: 4,
            shadowColor: "#000",
            shadowOpacity: 0.08,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 3 },
          }}
        >
          <Text
            style={{
              paddingHorizontal: 10,
              paddingTop: 4,
              paddingBottom: 8,
              fontSize: 12,
              fontWeight: "600",
              color: "#6b7280",
            }}
          >
            PILIH {dateLabels[period]}
          </Text>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {options.map((opt, i) => {
              const active = i === selIdx;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    onSelect(i);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    minHeight: 58,
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    backgroundColor: active ? "#F0F7F1" : "#fff",
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 14,
                        fontWeight: active ? "700" : "500",
                        color: "#1f2937",
                      }}
                    >
                      {opt.label}
                    </Text>
                    <Text
                      style={{
                        marginTop: 2,
                        fontSize: 12,
                        color: "#6b7280",
                      }}
                    >
                      {relativeLabel(i)}
                    </Text>
                  </View>
                  {active ? (
                    <Check size={18} color="#47775B" strokeWidth={2.5} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function AqiBars({ series, page }: { series: Series; page: number }) {
  const { labels, values } = series;
  const lastStart = Math.max(0, values.length - page);
  const [start, setStart] = React.useState(lastStart);
  const pages = Math.max(1, Math.ceil(values.length / page));
  const activePage = pages - 1 - Math.ceil((lastStart - start) / page);
  const CHART_H = 110;
  const maxV = Math.max(150, ...values);

  const move = (dir: -1 | 1) =>
    setStart((s) => Math.min(lastStart, Math.max(0, s + dir * page)));

  return (
    <View style={{ paddingHorizontal: 10, paddingTop: 12, paddingBottom: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          height: CHART_H,
          borderBottomWidth: 1,
          borderStyle: "dashed",
          borderColor: "#111827",
        }}
      >
        {values.slice(start, start + page).map((v, i) => (
          <View
            key={start + i}
            style={{
              flex: 1,
              marginHorizontal: 4,
              height: (v / maxV) * CHART_H,
              backgroundColor: aqiColor(v),
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#374151" }}>
              {v}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {labels.slice(start, start + page).map((l, i) => (
          <Text
            key={start + i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 11,
              color: "#6b7280",
            }}
          >
            {l}
          </Text>
        ))}
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
        }}
      >
        <ArrowBtn dir="left" disabled={start === 0} onPress={() => move(-1)} />
        <View style={{ flexDirection: "row" }}>
          {Array.from({ length: pages }).map((_, i) => (
            <View
              key={i}
              style={{
                width: i === activePage ? 14 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: "#111827",
                marginHorizontal: 3,
              }}
            />
          ))}
        </View>
        <ArrowBtn
          dir="right"
          disabled={start === lastStart}
          onPress={() => move(1)}
        />
      </View>
    </View>
  );
}

function Scrub({
  width,
  height,
  series,
  unit,
  color,
  yOf,
  children,
}: {
  width: number;
  height: number;
  series: Series;
  unit: string;
  color: string;
  yOf: (v: number) => number;
  children: React.ReactNode;
}) {
  const { labels, values } = series;
  const N = values.length;
  const [sel, setSel] = React.useState(N - 1);

  const pan = React.useMemo(() => {
    const pick = (x: number) =>
      setSel(Math.round(Math.min(1, Math.max(0, x / width)) * (N - 1)));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
    });
  }, [width, N]);

  const x = (sel / (N - 1)) * width;
  const y = yOf(values[sel]);
  const fill = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as const;

  return (
    <View style={{ width, height }} {...pan.panHandlers}>
      <View pointerEvents="none" style={fill}>
        {children}
      </View>
      <View pointerEvents="none" style={fill}>
        <View
          style={{
            position: "absolute",
            left: x - 1,
            top: 30,
            width: 2,
            height: height - 30,
            backgroundColor: "rgba(0,0,0,0.3)",
          }}
        />
        <Svg width={width} height={height} style={{ position: "absolute" }}>
          <Circle
            cx={x}
            cy={y}
            r={4.5}
            fill="#fff"
            stroke={color}
            strokeWidth={2}
          />
        </Svg>
        <View
          style={{
            position: "absolute",
            left: Math.min(width - 60, Math.max(0, x - 30)),
            top: 6,
            width: 60,
            paddingVertical: 3,
            borderRadius: 10,
            backgroundColor: "rgba(255,255,255,0.9)",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: "700", color: "#374151" }}>
            {values[sel]}
            {unit}
          </Text>
        </View>
        <Text
          style={{
            position: "absolute",
            left: Math.min(width - 36, Math.max(0, x - 18)),
            bottom: 6,
            width: 36,
            textAlign: "center",
            fontSize: 10,
            color: "#6b7280",
          }}
        >
          {labels[sel]}
        </Text>
      </View>
    </View>
  );
}

function HeartLine({ width, series }: { width: number; series: Series }) {
  const H = 130;
  const { values } = series;
  const min = Math.min(...values) - 4;
  const max = Math.max(...values) + 4;
  const yOf = (v: number) => 40 + (1 - (v - min) / (max - min)) * (H - 40 - 28);
  const d = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"} ${((i / (values.length - 1)) * width).toFixed(1)} ${yOf(v).toFixed(1)}`,
    )
    .join(" ");
  return (
    <Scrub
      width={width}
      height={H}
      series={series}
      unit=" bpm"
      color="#F87171"
      yOf={yOf}
    >
      <Svg width={width} height={H}>
        <Path
          d={d}
          stroke="#F87171"
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Scrub>
  );
}

function SpO2Waves({ width, series }: { width: number; series: Series }) {
  const H = 130;
  const { values } = series;
  const yOf = (v: number) => 40 + ((100 - v) / 10) * (H - 40 - 20); // skala 90–100
  const area = (offset: number) =>
    values
      .map(
        (v, i) =>
          `${i ? "L" : "M"} ${((i / (values.length - 1)) * width).toFixed(1)} ${(yOf(v) - offset).toFixed(1)}`,
      )
      .join(" ") + ` L ${width} ${H} L 0 ${H} Z`;
  return (
    <Scrub
      width={width}
      height={H}
      series={series}
      unit="%"
      color="#38bdf8"
      yOf={yOf}
    >
      <Svg width={width} height={H}>
        <Path d={area(8)} fill="#CFF3FB" />
        <Path d={area(0)} fill="#B8EEFA" />
      </Svg>
    </Scrub>
  );
}

function EmptyHistory() {
  return (
    <View
      style={{
        alignItems: "center",
        marginTop: 8,
        marginBottom: 18,
        paddingHorizontal: 24,
        paddingVertical: 28,
        borderRadius: 22,
        backgroundColor: "#fff",
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 18,
          backgroundColor: "#EAF5ED",
          marginBottom: 14,
        }}
      >
        <CalendarDays size={24} color="#47775B" strokeWidth={2} />
      </View>
      <Text
        style={{
          fontSize: 16,
          fontWeight: "700",
          color: "#1f2937",
          textAlign: "center",
        }}
      >
        Belum ada data untuk periode ini
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontSize: 13,
          lineHeight: 19,
          color: "#6b7280",
          textAlign: "center",
        }}
      >
        Coba pilih tanggal lain atau rentang waktu yang lebih luas.
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function NotEnough() {
  return (
    <Text style={{ textAlign: "center", color: "#6b7280", fontSize: 12, paddingVertical: 24 }}>
      Belum cukup data (butuh minimal 2 siklus dengan nilai ini)
    </Text>
  );
}

export default function HistoryScreen() {
  const goTo = useTabNavigation();
  const { user } = useAuth();
  const { width: screenW } = useWindowDimensions();
  const [period, setPeriod] = React.useState<Period>("Hari");
  const [selIdx, setSelIdx] = React.useState(0);
  const innerW = screenW - 32 - 16;

  const options = React.useMemo(() => buildOptions(period), [period]);
  const current = options[selIdx] ?? options[0];
  const chartKey = `${period}-${current.key}`;

  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(0);
  const [tick, setTick] = React.useState(0);
  const loadedOnce = React.useRef(false);

  // Muat ulang saat layar dibuka & setiap ada data baru / selesai sinkron
  useFocusEffect(
    React.useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  React.useEffect(
    () =>
      subscribePending((n) => {
        setPending(n);
        setTick((t) => t + 1);
      }),
    [],
  );

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    if (!loadedOnce.current) setLoading(true); // refresh latar tanpa spinner
    setError("");
    fetchHistory(user.uid, period, current)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(e?.message ?? "Gagal memuat data");
      })
      .finally(() => {
        if (!cancelled) {
          loadedOnce.current = true;
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, period, current.key, tick]);

  // kosong hanya bila tidak ada satu pun data; tiap chart menangani kekurangan datanya sendiri
  const empty =
    !data ||
    (data.aqi.values.length === 0 &&
      data.hr.values.length === 0 &&
      data.spo2.values.length === 0);

  const handlePeriod = (p: Period) => {
    loadedOnce.current = false;
    setPeriod(p);
    setSelIdx(0);
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ marginBottom: 18 }}>
            <Text style={{ fontSize: 26, fontWeight: "700", color: "#1f2937" }}>
              Riwayat
            </Text>
          </View>

          {pending > 0 ? (
            <Pressable
              onPress={() => void flushQueue()}
              style={{
                marginBottom: 12,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: "#FEF3C7",
              }}
            >
              <Text style={{ fontSize: 12, color: "#92400E" }}>
                {pending} data tersimpan di HP, belum tersinkron ke Firebase. Ketuk untuk sinkron sekarang.
              </Text>
            </Pressable>
          ) : null}

          <PeriodSelector period={period} onSelect={handlePeriod} />

          <DateDropdown
            key={period}
            period={period}
            options={options}
            selIdx={selIdx}
            onSelect={setSelIdx}
          />

          {loading ? (
            <ActivityIndicator color="#6B9E7E" style={{ marginTop: 40 }} />
          ) : error ? (
            <Text
              style={{ textAlign: "center", color: "#DC2626", marginTop: 24 }}
            >
              {error}
            </Text>
          ) : empty ? (
            <EmptyHistory />
          ) : (
            <>
              <ChartCard dropdown="AQI⁺" innerBg="#EEF0F2">
                {data!.aqi.values.length > 0 ? (
                  <AqiBars
                    key={chartKey}
                    series={data!.aqi}
                    page={BARS_PER_PAGE[period]}
                  />
                ) : (
                  <NotEnough />
                )}
              </ChartCard>

              <ChartCard
                title="Detak Jantung"
                dropdown={data!.resolution ?? RESOLUTION[period]}
                innerBg="#F1FDEE"
              >
                {data!.hr.values.length >= 2 ? (
                  <HeartLine key={chartKey} width={innerW} series={data!.hr} />
                ) : (
                  <NotEnough />
                )}
              </ChartCard>

              <ChartCard
                title="SpO2"
                dropdown={data!.resolution ?? RESOLUTION[period]}
                innerBg="#E6FAFE"
              >
                {data!.spo2.values.length >= 2 ? (
                  <SpO2Waves key={chartKey} width={innerW} series={data!.spo2} />
                ) : (
                  <NotEnough />
                )}
              </ChartCard>
            </>
          )}
        </ScrollView>

        <BottomNavbar activeTab="history" onTabPress={goTo} />
      </SafeAreaView>
    </ScreenBackground>
  );
}
