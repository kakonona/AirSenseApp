import React from "react";
import { Image, Pressable, Text, View } from "react-native";

// Peta OpenStreetMap gratis tanpa API key: tile 256px disusun manual + pin di tengah.
// Tile diambil lewat proxy Worker (cache + User-Agent sesuai kebijakan OSM).
const TILE = 256;
const API_URL = process.env.EXPO_PUBLIC_ALERT_API_URL?.replace(/\/+$/, "");

function tileUrl(z: number, x: number, y: number) {
  return API_URL
    ? `${API_URL}/tile/${z}/${x}/${y}.png`
    : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function project(lat: number, lon: number, z: number) {
  const n = 2 ** z * TILE;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

export function OsmMap({
  latitude,
  longitude,
  width,
  height = 220,
  initialZoom = 16,
  onPress,
}: {
  latitude: number;
  longitude: number;
  width: number;
  height?: number;
  initialZoom?: number;
  onPress?: () => void;
}) {
  const [zoom, setZoom] = React.useState(initialZoom);
  const center = project(latitude, longitude, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const max = 2 ** zoom;

  const tiles: { key: string; x: number; y: number; tx: number; ty: number }[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      const wrapped = ((tx % max) + max) % max;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        x: tx * TILE - left,
        y: ty * TILE - top,
        tx: wrapped,
        ty,
      });
    }
  }

  const zoomButton = (label: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={delta > 0 ? "Perbesar peta" : "Perkecil peta"}
      onPress={() => setZoom((z) => Math.min(19, Math.max(3, z + delta)))}
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        backgroundColor: "rgba(255,255,255,0.95)",
        alignItems: "center",
        justifyContent: "center",
        elevation: 2,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: "700", color: "#1f3a2e" }}>{label}</Text>
    </Pressable>
  );

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: "#E5E7EB",
      }}
    >
      <Pressable onPress={onPress} style={{ width, height }}>
        {tiles.map((t) => (
          <Image
            key={t.key}
            source={{ uri: tileUrl(zoom, t.tx, t.ty) }}
            style={{ position: "absolute", left: t.x, top: t.y, width: TILE, height: TILE }}
          />
        ))}
        {/* pin lokasi */}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: width / 2 - 14,
            top: height / 2 - 34,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#e11d48",
              borderWidth: 3,
              borderColor: "#fff",
              elevation: 4,
            }}
          />
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 6,
              borderRightWidth: 6,
              borderTopWidth: 9,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderTopColor: "#e11d48",
              marginTop: -2,
            }}
          />
        </View>
      </Pressable>
      <View style={{ position: "absolute", right: 8, top: 8, gap: 6 }}>
        {zoomButton("+", 1)}
        {zoomButton("−", -1)}
      </View>
      <Text
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          fontSize: 9,
          color: "#374151",
          backgroundColor: "rgba(255,255,255,0.8)",
          paddingHorizontal: 4,
          paddingVertical: 1,
        }}
      >
        © OpenStreetMap contributors
      </Text>
    </View>
  );
}
