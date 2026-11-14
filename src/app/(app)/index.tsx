import { AirQualityScore } from "@/components/air-quality-score";
import { MetricCard } from "@/components/metric-card";
import BottomNavbar from "@/components/navbar";
import { RecommendationCard } from "@/components/recommendation-card";
import { ScreenBackground } from "@/components/screen-background";
import { useAuth } from "@/context/auth-context";
import { getRecommendations, getStatus } from "@/data/mock-air-quality";
import { useBlePairing } from "@/hooks/use-ble-pairing";
import { EMPTY_DEVICE, useDevice, useRecentBpm } from "@/hooks/use-device";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const todayLabel = () => {
  const d = new Date();
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const greeting = () => {
  const h = new Date().getHours();
  return h < 11
    ? "Selamat pagi"
    : h < 15
      ? "Selamat siang"
      : h < 18
        ? "Selamat sore"
        : "Selamat malam";
};

export default function HomeScreen() {
  const goTo = useTabNavigation();
  const router = useRouter();
  const { user } = useAuth();
  const { device } = useDevice(user?.uid);
  const bpmHistory = useRecentBpm(user?.uid, 12);
  const [showDevicePicker, setShowDevicePicker] = React.useState(false);
  const ble = useBlePairing();

  const openDevicePicker = React.useCallback(() => {
    setShowDevicePicker(true);
    void ble.scanForDevices().catch((error: unknown) => {
      console.warn("BLE scan failed:", error);
    });
  }, [ble.scanForDevices]);

  const closeDevicePicker = React.useCallback(() => {
    ble.stopScan();
    setShowDevicePicker(false);
  }, [ble.stopScan]);

  const chooseDevice = React.useCallback(
    (candidate: (typeof ble.devices)[number]) => {
      void ble
        .connectToDevice(candidate)
        .then(() => setShowDevicePicker(false))
        .catch((error: unknown) => {
          console.warn("BLE connection failed:", error);
        });
    },
    [ble.connectToDevice],
  );

  const d = device ?? EMPTY_DEVICE;
  const name =
    user?.displayName?.trim() || user?.email?.split("@")[0] || "Pengguna";
  const hasWearable =
    d.wearable_added === true ||
    d.status === "online" ||
    d.aqi > 0 ||
    d.pm25 > 0 ||
    d.pm10 > 0 ||
    d.co > 0 ||
    d.spo2 > 0 ||
    d.bpm > 0;
  const status = getStatus(d.aqi);
  const recommendations = getRecommendations(status, d.aqi);

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View
                style={{
                  backgroundColor: "#fcd34d",
                  borderRadius: 50,
                  width: 48,
                  height: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {user?.photoURL ? (
                  <Image
                    source={{ uri: user.photoURL }}
                    accessibilityLabel={`Foto profil ${name}`}
                    style={{ width: 48, height: 48 }}
                  />
                ) : (
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: "bold",
                      color: "#78350f",
                    }}
                  >
                    {name.charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <View>
                <Text style={{ fontSize: 12, color: "#9ca3af" }}>
                  {greeting()}
                </Text>
                <Text
                  style={{ fontSize: 18, fontWeight: "bold", color: "#111827" }}
                >
                  {name}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Riwayat notifikasi"
              onPress={() => router.push("/notifications")}
              style={{
                backgroundColor: "#fee2e2",
                borderRadius: 50,
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: "#fecaca",
              }}
            >
              <Feather name="bell" size={18} color="#dc2626" />
            </Pressable>
          </View>

          {!hasWearable ? (
            <View
              style={{
                marginHorizontal: 16,
                marginTop: 24,
                padding: 24,
                alignItems: "center",
                backgroundColor: "#fff",
                borderRadius: 24,
                shadowColor: "#000",
                shadowOpacity: 0.05,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              <View
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 30,
                  backgroundColor: "#E8F3EC",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 16,
                }}
              >
                <Feather name="bluetooth" size={28} color="#356347" />
              </View>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: "700",
                  color: "#111827",
                  textAlign: "center",
                }}
              >
                Belum ada wearable
              </Text>
              <Text
                style={{
                  marginTop: 8,
                  marginBottom: 20,
                  fontSize: 14,
                  lineHeight: 20,
                  color: "#6B7280",
                  textAlign: "center",
                }}
              >
                Tambahkan perangkat AirSense untuk melihat data sensor di sini.
              </Text>
              <Pressable
                accessibilityRole="button"
                android_ripple={{ color: "#244A34" }}
                onPress={openDevicePicker}
                style={{
                  width: "100%",
                  minHeight: 48,
                  borderRadius: 16,
                  backgroundColor: "#356347",
                  borderWidth: 1,
                  borderColor: "#2B533B",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  elevation: 2,
                }}
              >
                <Feather name="plus" size={18} color="#fff" />
                <Text
                  style={{
                    marginLeft: 8,
                    color: "#fff",
                    fontSize: 15,
                    fontWeight: "600",
                  }}
                >
                  Tambah perangkat
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View
                accessibilityRole="summary"
                style={{
                  marginHorizontal: 16,
                  marginTop: 12,
                  padding: 16,
                  borderRadius: 18,
                  backgroundColor: "#fff",
                  flexDirection: "row",
                  alignItems: "center",
                  shadowColor: "#000",
                  shadowOpacity: 0.05,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 2,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor:
                      d.status === "online" ? "#E8F3EC" : "#F3F4F6",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                  }}
                >
                  <Feather
                    name="bluetooth"
                    size={20}
                    color={d.status === "online" ? "#356347" : "#6B7280"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: "#111827",
                    }}
                  >
                    {ble.selectedDevice?.name ?? "Wearable AirSense"}
                  </Text>
                  <Text
                    style={{
                      marginTop: 3,
                      fontSize: 13,
                      color: d.status === "online" ? "#356347" : "#6B7280",
                    }}
                  >
                    {d.status === "online" ? "Online" : "Offline"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    ble.connected
                      ? "Ganti perangkat AirSense"
                      : "Hubungkan perangkat AirSense"
                  }
                  onPress={openDevicePicker}
                  style={{
                    marginLeft: 12,
                    paddingVertical: 8,
                    paddingHorizontal: 10,
                    borderRadius: 12,
                    backgroundColor: "#E8F3EC",
                  }}
                >
                  <Text
                    style={{
                      color: "#356347",
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {ble.connected ? "Ganti" : "Hubungkan"}
                  </Text>
                </Pressable>
              </View>

              {d.status !== "online" && (
                <Text
                  style={{
                    marginHorizontal: 16,
                    marginTop: 8,
                    fontSize: 12,
                    color: "#6b7280",
                    textAlign: "center",
                  }}
                >
                  Menampilkan data terakhir yang diterima.
                </Text>
              )}

              <View style={{ paddingVertical: 16, paddingHorizontal: 2 }}>
                <AirQualityScore
                  score={d.aqi}
                  date={todayLabel()}
                  pollutants={[
                    {
                      label: "PM2.5",
                      value: d.pm25,
                      unit: "µg/m³",
                      color: "#F0BD8C",
                    },
                    {
                      label: "PM10",
                      value: d.pm10 ?? 0,
                      unit: "µg/m³",
                      color: "#F5E08C",
                    },
                    { label: "CO", value: d.co, unit: "ppm", color: "#A8D3B9" },
                  ]}
                />
              </View>

              <View style={{ paddingBottom: 16, paddingHorizontal: 2 }}>
                <MetricCard
                  spo2={d.spo2}
                  heartRate={d.bpm}
                  bpmHistory={bpmHistory}
                />
              </View>

              <View style={{ paddingHorizontal: 16, paddingBottom: 32 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "bold",
                    color: "#111827",
                    marginBottom: 16,
                  }}
                >
                  Rekomendasi
                </Text>
                {recommendations.length > 0 ? (
                  recommendations.map((rec) => (
                    <RecommendationCard key={rec.id} recommendation={rec} />
                  ))
                ) : (
                  <Text style={{ fontSize: 14, color: "#6b7280" }}>
                    Tidak ada rekomendasi saat ini.
                  </Text>
                )}
              </View>
            </>
          )}
        </ScrollView>
        <BottomNavbar activeTab="home" onTabPress={goTo} />
        <Modal
          visible={showDevicePicker}
          transparent
          animationType="fade"
          onRequestClose={closeDevicePicker}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              padding: 24,
              backgroundColor: "rgba(17, 24, 39, 0.45)",
            }}
          >
            <View
              style={{
                maxHeight: "80%",
                padding: 20,
                borderRadius: 24,
                backgroundColor: "#fff",
              }}
            >
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: "700",
                  color: "#111827",
                }}
              >
                Hubungkan perangkat
              </Text>
              <Text
                style={{
                  marginTop: 6,
                  marginBottom: 16,
                  fontSize: 13,
                  lineHeight: 19,
                  color: "#6B7280",
                }}
              >
                Nyalakan ESP32-S3 Mini dan pastikan Bluetooth aktif.
              </Text>

              {ble.error ? (
                <Text
                  accessibilityRole="alert"
                  style={{
                    marginBottom: 12,
                    color: "#B42318",
                    fontSize: 13,
                    lineHeight: 19,
                  }}
                >
                  {ble.error}
                </Text>
              ) : null}

              {ble.scanning && ble.devices.length === 0 ? (
                <View
                  style={{
                    alignItems: "center",
                    paddingVertical: 24,
                  }}
                >
                  <ActivityIndicator color="#356347" />
                  <Text
                    style={{ marginTop: 10, color: "#6B7280", fontSize: 13 }}
                  >
                    Mencari AirSense...
                  </Text>
                </View>
              ) : null}

              {!ble.scanning && ble.devices.length === 0 && !ble.error ? (
                <Text
                  style={{
                    paddingVertical: 18,
                    textAlign: "center",
                    color: "#6B7280",
                    fontSize: 13,
                  }}
                >
                  Belum ada perangkat ditemukan. Pastikan ESP32 mengiklankan
                  service BLE AirSense.
                </Text>
              ) : null}

              {ble.devices.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  accessibilityRole="button"
                  disabled={ble.connecting}
                  onPress={() => chooseDevice(candidate)}
                  style={{
                    minHeight: 56,
                    marginBottom: 8,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    backgroundColor: "#F3F7F4",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    opacity: ble.connecting ? 0.6 : 1,
                  }}
                >
                  <View>
                    <Text
                      style={{
                        fontWeight: "600",
                        color: "#111827",
                      }}
                    >
                      {candidate.name}
                    </Text>
                    <Text
                      style={{
                        marginTop: 3,
                        color: "#6B7280",
                        fontSize: 12,
                      }}
                    >
                      {candidate.rssi === null
                        ? "BLE AirSense"
                        : `Sinyal ${candidate.rssi} dBm`}
                    </Text>
                  </View>
                  {ble.connecting ? (
                    <ActivityIndicator color="#356347" />
                  ) : (
                    <Feather name="bluetooth" size={18} color="#356347" />
                  )}
                </Pressable>
              ))}

              <View
                style={{
                  marginTop: 8,
                  flexDirection: "row",
                  justifyContent: "flex-end",
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  disabled={ble.scanning || ble.connecting}
                  onPress={() =>
                    void ble.scanForDevices().catch((error: unknown) => {
                      console.warn("BLE scan failed:", error);
                    })
                  }
                  style={{
                    padding: 10,
                    opacity: ble.scanning || ble.connecting ? 0.5 : 1,
                  }}
                >
                  <Text style={{ color: "#356347", fontWeight: "600" }}>
                    Cari lagi
                  </Text>
                </Pressable>
                {ble.selectedDevice ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={ble.connecting}
                    onPress={() =>
                      void ble.removeDevice().catch((error: unknown) => {
                        console.warn("BLE device removal failed:", error);
                      })
                    }
                    style={{
                      padding: 10,
                      opacity: ble.connecting ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ color: "#B42318", fontWeight: "600" }}>
                      Lepas
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={closeDevicePicker}
                  style={{ padding: 10 }}
                >
                  <Text style={{ color: "#6B7280", fontWeight: "600" }}>
                    Tutup
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ScreenBackground>
  );
}
