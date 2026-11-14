import { useAuth } from "@/context/auth-context";
import { db } from "@/lib/firebase";
import { pendingDocs, subscribePending } from "@/lib/offline-queue";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DARK = "#1f3a2e";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  timestampMs: number;
  parameter: string;
  value: number | string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  direction: "own" | "received";
  recipientType: string;
  targetUid: string | null;
  senderName: string | null;
};

function toMillis(value: unknown) {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return 0;
}

function fallbackTitle(parameter: string, status: string) {
  const severity = status === "danger" ? "KRITIS" : "PERINGATAN";
  if (parameter === "SpO2") return `${severity}: SpO₂`;
  if (parameter === "BPM") return `${severity}: Denyut jantung`;
  return `${severity}: Kualitas udara`;
}

function parseItem(id: string, x: Record<string, unknown>): NotificationItem {
  const parameter = typeof x.parameter === "string" ? x.parameter : "-";
  const status = typeof x.status === "string" ? x.status : "warning";
  const location =
    x.location && typeof x.location === "object"
      ? (x.location as { latitude?: unknown; longitude?: unknown })
      : null;
  const lat = typeof location?.latitude === "number" ? location.latitude : null;
  const lon = typeof location?.longitude === "number" ? location.longitude : null;
  const value =
    typeof x.value === "number" || typeof x.value === "string" ? x.value : "—";
  return {
    id,
    title: typeof x.title === "string" ? x.title : fallbackTitle(parameter, status),
    body:
      typeof x.body === "string"
        ? x.body
        : `${parameter} ${value}${lat !== null ? ` · Lokasi ${lat.toFixed(5)}, ${lon?.toFixed(5)}` : ""}`,
    timestampMs: toMillis(x.recorded_at ?? x.timestamp),
    parameter,
    value,
    status,
    latitude: lat,
    longitude: lon,
    direction: x.direction === "received" ? "received" : "own",
    recipientType: typeof x.recipientType === "string" ? x.recipientType : "owner",
    targetUid: typeof x.targetUid === "string" ? x.targetUid : null,
    senderName: typeof x.sender_name === "string" ? x.sender_name : null,
  };
}

function formatTime(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [remote, setItems] = React.useState<NotificationItem[] | null>(null);
  const [local, setLocal] = React.useState<NotificationItem[]>([]);

  // Notifikasi yang masih tersimpan di HP (belum tersinkron) tetap tampil
  React.useEffect(() => {
    if (!user) return;
    return subscribePending(() => {
      void pendingDocs(["profile", user.uid, "notifications"])
        .then((docs) => setLocal(docs.map((d) => parseItem(d.id, d.data))))
        .catch(() => setLocal([]));
    });
  }, [user]);

  const items = React.useMemo(() => {
    if (remote === null && local.length === 0) return null;
    const byId = new Map<string, NotificationItem>();
    for (const it of remote ?? []) byId.set(it.id, it);
    for (const it of local) byId.set(it.id, { ...byId.get(it.id), ...it });
    return [...byId.values()].sort((a, b) => b.timestampMs - a.timestampMs);
  }, [remote, local]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "profile", user.uid, "notifications"),
      orderBy("timestamp", "desc"),
      limit(200),
    );
    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        setItems(snap.docs.map((d) => parseItem(d.id, d.data())));
      },
      (snapshotError) => {
        console.error("Could not load notification history:", snapshotError);
        setError("Riwayat notifikasi tidak dapat dimuat.");
        setItems([]);
      },
    );
  }, [user]);

  const open = (item: NotificationItem) => {
    const params: Record<string, string> = {
      notifId: item.id,
      parameter: item.parameter,
      value: String(item.value),
      status: item.status,
      recipientType: item.recipientType,
      timestampMs: String(item.timestampMs),
    };
    if (item.targetUid) params.targetUid = item.targetUid;
    if (item.senderName) params.senderName = item.senderName;
    if (item.latitude !== null && item.longitude !== null) {
      params.latitude = String(item.latitude);
      params.longitude = String(item.longitude);
    }
    router.push({ pathname: "/emergency-alert", params });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F7F8F3" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Kembali"
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Feather name="arrow-left" size={22} color={DARK} />
        </Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: DARK }}>
          Riwayat Notifikasi
        </Text>
      </View>

      {items === null ? (
        <ActivityIndicator color="#6B9E7E" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={{ color: "#637067", textAlign: "center", marginTop: 40 }}>
              {error ?? "Belum ada notifikasi."}
            </Text>
          }
          renderItem={({ item }) => {
            const danger = item.status === "danger";
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => open(item)}
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 16,
                  padding: 14,
                  flexDirection: "row",
                  gap: 12,
                  borderLeftWidth: 4,
                  borderLeftColor: danger ? "#dc2626" : "#f59e0b",
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: danger ? "#fee2e2" : "#fef3c7",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={item.direction === "received" ? "users" : "alert-triangle"}
                    size={17}
                    color={danger ? "#dc2626" : "#b45309"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", color: DARK }}>{item.title}</Text>
                  {item.senderName ? (
                    <Text style={{ color: "#637067", fontSize: 12, marginTop: 2 }}>
                      Dari {item.senderName}
                    </Text>
                  ) : null}
                  <Text style={{ color: "#34423A", marginTop: 4 }}>{item.body}</Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 6,
                    }}
                  >
                    <Text style={{ color: "#9ca3af", fontSize: 12 }}>
                      {formatTime(item.timestampMs)}
                    </Text>
                    {item.latitude !== null ? (
                      <Feather name="map-pin" size={12} color="#6B9E7E" />
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
