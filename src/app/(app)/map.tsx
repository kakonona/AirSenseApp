import BottomNavbar from "@/components/navbar";
import { ScreenBackground } from "@/components/screen-background";
import {
  AddUserModal,
  InviteCard,
  ShareAccessModal,
} from "@/components/sharing-modals";
import { useAuth } from "@/context/auth-context";
import {
  EMPTY_DEVICE,
  useDevice,
  useMonitoring,
  type MonitoredUser,
} from "@/hooks/use-device";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Path, Svg } from "react-native-svg";

type Monitored = {
  id: string;
  name: string;
  online: boolean;
  bpm: number;
  spo2: number;
  aqi: number;
  pm25: number;
  pm10: number;
  co: number;
};

const CARD_H = 124;
const DARK = "#1f3a2e";

function aqiColor(v: number) {
  if (v <= 50) return "#A8D3B9";
  if (v <= 100) return "#F5E08C";
  if (v <= 125) return "#F7BE79";
  if (v <= 150) return "#F09A78";
  return "#E0948C";
}
const hrLabel = (v: number) =>
  v < 60 ? "bradikardi" : v <= 100 ? "normal" : "takikardi";
const spo2Label = (v: number) =>
  v >= 95 ? "normal" : v >= 90 ? "hipoksemia ringan" : "hipoksemia";

const shadow = {
  elevation: 3,
  shadowColor: "#000",
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
} as const;

// Garis EKG statis (dekoratif)
const EKG_PATH = Array.from({ length: 61 }, (_, i) => {
  const x = i * (100 / 60);
  const env = 0.2 + (i / 60) * 0.8;
  const spike = i % 9 === 4 ? -18 : i % 9 === 5 ? 10 : 0;
  const y = 22 + Math.sin(i * 1.9) * 3 * env + spike * env;
  return `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
}).join(" ");

function ActionCard({
  title,
  iconBg,
  onPress,
}: {
  title: string;
  iconBg: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: "#fff",
        borderRadius: 28,
        paddingVertical: 12,
        paddingLeft: 20,
        paddingRight: 12,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        ...shadow,
      }}
    >
      <Text style={{ fontSize: 17, fontWeight: "700", color: DARK }}>
        {title}
      </Text>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: iconBg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 20 }}>⌚</Text>
      </View>
    </Pressable>
  );
}

function MiniHeader({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: "#f3f4f6",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 4,
        }}
      >
        <Text style={{ fontSize: 8 }}>❤️</Text>
      </View>
      <Text style={{ fontSize: 8, fontWeight: "700", color: "#1f2937" }}>
        {label}
      </Text>
    </View>
  );
}

function BigValue({
  value,
  unit,
  label,
}: {
  value: number;
  unit: string;
  label: string;
}) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <Text
          style={{
            fontSize: 30,
            fontWeight: "600",
            color: "#111827",
            lineHeight: 34,
          }}
        >
          {value}
        </Text>
        <Text
          style={{
            fontSize: 10,
            color: "#374151",
            marginBottom: 5,
            marginLeft: 2,
          }}
        >
          {unit}
        </Text>
      </View>
      <Text style={{ fontSize: 10, color: "#6b7280" }}>{label}</Text>
    </View>
  );
}

function HeartMini({ bpm }: { bpm: number }) {
  return (
    <View
      style={{
        flex: 1.15,
        height: CARD_H,
        borderRadius: 16,
        backgroundColor: "#F1FDEE",
        padding: 8,
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 30 }}
      >
        <Svg
          width="100%"
          height={44}
          viewBox="0 0 100 44"
          preserveAspectRatio="none"
        >
          <Path
            d={EKG_PATH}
            stroke="#F4A6A0"
            strokeWidth={1.2}
            fill="none"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <MiniHeader label="Detak Jantung" />
      <BigValue value={bpm} unit="bpm" label={hrLabel(bpm)} />
    </View>
  );
}

function Spo2Mini({ value }: { value: number }) {
  const y = 36 + (100 - value) * 3;
  const water = (yy: number) =>
    `M 0 ${yy} C 25 ${yy - 8}, 40 ${yy + 8}, 60 ${yy} S 90 ${yy - 8}, 100 ${yy} L 100 100 L 0 100 Z`;
  return (
    <View
      style={{
        flex: 0.9,
        height: CARD_H,
        borderRadius: 16,
        backgroundColor: "#E6FAFE",
        padding: 8,
        justifyContent: "space-between",
        overflow: "hidden",
      }}
    >
      <View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <Path d={water(y - 4)} fill="#CFF3FB" />
          <Path d={water(y + 2)} fill="#B8EEFA" />
        </Svg>
      </View>
      <MiniHeader label="SPO2" />
      <BigValue value={value} unit="%" label={spo2Label(value)} />
    </View>
  );
}

function AqiMini({ u }: { u: Monitored }) {
  const rows = [
    { tag: "PM₂.₅", color: "#F7BE79", val: u.pm25, unit: "µg/m³" },
    { tag: "PM₁₀", color: "#F5E08C", val: u.pm10, unit: "µg/m³" },
    { tag: "CO", color: "#A8D3B9", val: u.co, unit: "ppm" },
  ];
  return (
    <View
      style={{
        flex: 1.1,
        height: CARD_H,
        borderRadius: 16,
        backgroundColor: "#fff",
        padding: 8,
        justifyContent: "space-between",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "700", color: "#111827" }}>
          AQI
        </Text>
        <View
          style={{
            backgroundColor: aqiColor(u.aqi),
            borderRadius: 10,
            paddingHorizontal: 9,
            paddingVertical: 2,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#374151" }}>
            {u.aqi}
          </Text>
        </View>
      </View>
      {rows.map((r) => (
        <View
          key={r.tag}
          style={{ flexDirection: "row", alignItems: "center" }}
        >
          <View
            style={{
              width: 28,
              height: 22,
              borderRadius: 11,
              backgroundColor: r.color,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 5,
            }}
          >
            <Text style={{ fontSize: 7, fontWeight: "700", color: "#374151" }}>
              {r.tag}
            </Text>
          </View>
          <Text style={{ fontSize: 8, color: "#374151" }} numberOfLines={1}>
            {r.val} {r.unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

function UserCard({ u }: { u: Monitored }) {
  return (
    <View
      style={{
        backgroundColor: "#fff",
        borderRadius: 28,
        padding: 10,
        marginBottom: 14,
        ...shadow,
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}
      >
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            backgroundColor: "#D9D2F5",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 10,
          }}
        >
          <Text style={{ fontSize: 20 }}>⌚</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 17,
              fontWeight: "600",
              fontStyle: "italic",
              color: DARK,
            }}
          >
            {u.name}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: u.online ? "#A8E6BC" : "#E5E7EB",
            borderRadius: 14,
            paddingHorizontal: 18,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: u.online ? "#1f5a36" : "#6b7280",
            }}
          >
            {u.online ? "Online" : "Offline"}
          </Text>
        </View>
      </View>

      <View
        style={{
          backgroundColor: "#EEF0F2",
          borderRadius: 20,
          padding: 8,
          flexDirection: "row",
          gap: 8,
        }}
      >
        <HeartMini bpm={u.bpm} />
        <Spo2Mini value={u.spo2} />
        <AqiMini u={u} />
      </View>
    </View>
  );
}

function MonitoredItem({ m }: { m: MonitoredUser }) {
  const { device } = useDevice(m.target_uid);
  const d = device ?? EMPTY_DEVICE;
  return (
    <UserCard
      u={{
        id: m.monitoringId,
        name: m.target_name,
        online: d.status === "online",
        bpm: d.bpm,
        spo2: d.spo2,
        aqi: d.aqi,
        pm25: d.pm25,
        pm10: d.pm10 ?? 0,
        co: d.co,
      }}
    />
  );
}

export default function MonitorScreen() {
  const goTo = useTabNavigation();
  const { user } = useAuth();
  const { accepted, pending } = useMonitoring(user?.uid);
  const [addOpen, setAddOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);

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
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 26, fontWeight: "700", color: DARK }}>
              Monitor
            </Text>
          </View>

          <ActionCard
            title="Akses Pemantauan"
            iconBg="#A8D3B9"
            onPress={() => setShareOpen(true)}
          />
          <ActionCard
            title="Tambahkan Pengguna"
            iconBg="#D9D2F5"
            onPress={() => setAddOpen(true)}
          />

          <View style={{ height: 6 }} />

          {pending.map((p) => (
            <InviteCard key={p.monitoringId} invite={p} />
          ))}

          {accepted.length === 0 && pending.length === 0 ? (
            <Text
              style={{ textAlign: "center", color: "#6b7280", marginTop: 24 }}
            >
              Belum ada pengguna yang dipantau
            </Text>
          ) : (
            accepted.map((m) => <MonitoredItem key={m.monitoringId} m={m} />)
          )}
        </ScrollView>

        <BottomNavbar activeTab="friends" onTabPress={goTo} />
      </SafeAreaView>

      <AddUserModal visible={addOpen} onClose={() => setAddOpen(false)} />
      <ShareAccessModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </ScreenBackground>
  );
}
