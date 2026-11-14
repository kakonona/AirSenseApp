import { OsmMap } from "@/components/osm-map";
import { useDevice } from "@/hooks/use-device";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DARK = "#1f3a2e";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: "44%",
        backgroundColor: "#F3F7F1",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <Text style={{ color: "#637067", fontSize: 12 }}>{label}</Text>
      <Text style={{ color: DARK, fontWeight: "700", fontSize: 22, marginTop: 6 }}>
        {value} <Text style={{ fontSize: 13, fontWeight: "500" }}>{unit}</Text>
      </Text>
    </View>
  );
}

export default function EmergencyAlertScreen() {
  const params = useLocalSearchParams<{
    parameter?: string | string[];
    value?: string | string[];
    status?: string | string[];
    recipientType?: string | string[];
    targetUid?: string | string[];
    latitude?: string | string[];
    longitude?: string | string[];
    timestampMs?: string | string[];
    senderName?: string | string[];
  }>();
  const { width: screenW } = useWindowDimensions();
  const timestampMs = Number(first(params.timestampMs));
  const senderName = first(params.senderName);
  const recipientType = first(params.recipientType);
  const targetUid = first(params.targetUid);
  const { device } = useDevice(
    recipientType === "registered" ? targetUid : null,
  );
  const parameter = first(params.parameter) ?? "Kondisi sensor";
  const value = first(params.value) ?? "—";
  const status = first(params.status);
  const latitude = Number(first(params.latitude));
  const longitude = Number(first(params.longitude));
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const isDanger = status === "danger";

  const openLocation = async () => {
    if (!hasLocation) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.error("Could not open emergency map location:", error);
      Alert.alert("Lokasi tidak dapat dibuka", "Coba buka tautan peta secara manual.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F7F8F3" }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
        <View
          style={{
            backgroundColor: isDanger ? "#FFF0EF" : "#FFF8E8",
            borderRadius: 24,
            padding: 22,
            borderWidth: 1,
            borderColor: isDanger ? "#F4C7C4" : "#F2DEA5",
          }}
        >
          <Text style={{ color: isDanger ? "#B42318" : "#946200", fontWeight: "700" }}>
            {isDanger ? "KONDISI KRITIS" : "PERINGATAN"}
          </Text>
          <Text style={{ color: DARK, fontWeight: "700", fontSize: 25, marginTop: 8 }}>
            {parameter}
          </Text>
          <Text style={{ color: "#34423A", fontSize: 16, marginTop: 10 }}>
            Nilai saat kejadian: {value}
          </Text>
          {senderName ? (
            <Text style={{ color: "#34423A", marginTop: 6 }}>Dari: {senderName}</Text>
          ) : null}
          {Number.isFinite(timestampMs) && timestampMs > 0 ? (
            <Text style={{ color: "#637067", marginTop: 6 }}>
              {new Date(timestampMs).toLocaleString("id-ID")}
            </Text>
          ) : null}
        </View>

        {recipientType === "registered" && device ? (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: DARK, fontSize: 18, fontWeight: "700", marginBottom: 12 }}>
              Status langsung pengemudi
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Metric label="SpO₂" value={device.spo2} unit="%" />
              <Metric label="Denyut jantung" value={device.bpm} unit="BPM" />
              <Metric label="AQI" value={device.aqi} unit="" />
            </View>
          </View>
        ) : (
          <Text style={{ color: "#637067", lineHeight: 22, marginTop: 16 }}>
            {recipientType === "guest"
              ? "Ini adalah snapshot kondisi dan lokasi pada saat kejadian."
              : "Detail snapshot kejadian dari notifikasi."}
          </Text>
        )}

        {hasLocation ? (
          <View style={{ marginTop: 22 }}>
            <Text style={{ color: DARK, fontSize: 18, fontWeight: "700", marginBottom: 10 }}>
              Lokasi kejadian
            </Text>
            <OsmMap
              latitude={latitude}
              longitude={longitude}
              width={screenW - 40}
              height={240}
              onPress={() => void openLocation()}
            />
            <Text style={{ color: "#637067", marginTop: 8 }}>
              {latitude.toFixed(5)}, {longitude.toFixed(5)}
            </Text>
          </View>
        ) : null}

        {hasLocation ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void openLocation()}
            style={{
              minHeight: 52,
              borderRadius: 16,
              backgroundColor: DARK,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 22,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>
              Buka lokasi kejadian di peta
            </Text>
          </Pressable>
        ) : (
          <Text style={{ color: "#637067", marginTop: 18 }}>
            Koordinat lokasi tidak tersedia pada notifikasi ini. Pastikan izin lokasi
            diberikan dan GPS HP pengemudi menyala saat kejadian.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
