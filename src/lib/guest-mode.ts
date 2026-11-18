import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import React from "react";

// ── Mode tamu (Kontak Darurat tanpa akun) ────────────────────────────────────
// Semua disimpan di HP saja (AsyncStorage): siapa yang dipantau dan peringatan yang
// pernah masuk. Tidak ada baca/tulis Firestore. Notifikasinya sendiri dikirim FCM ke
// sistem Android, jadi tetap muncul walau aplikasi ditutup atau berada di halaman awal.

export type GuestOwner = {
  inviteId: string;
  ownerName: string;
  acceptedAt: number;
};

export type GuestAlert = {
  id: string;
  ownerName: string;
  parameter: string;
  value: string;
  status: string;
  timestampMs: number;
  latitude?: string;
  longitude?: string;
  // Data notifikasi asli, untuk membuka halaman Peringatan Darurat lagi
  params: Record<string, string>;
};

export type GuestState = { owners: GuestOwner[]; alerts: GuestAlert[] };

const KEY = "airsense:guest:v1";
const MAX_ALERTS = 20;
const EMPTY: GuestState = { owners: [], alerts: [] };

let state: GuestState = EMPTY;
let loaded: Promise<void> | null = null;
const listeners = new Set<(s: GuestState) => void>();

function load() {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<GuestState>;
        state = {
          owners: Array.isArray(parsed.owners) ? parsed.owners : [],
          alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
        };
      })
      .catch((error: unknown) => console.warn("[guest] Data tamu tidak terbaca:", error));
  }
  return loaded;
}

async function save(next: GuestState) {
  state = next;
  for (const listener of listeners) listener(state);
  await AsyncStorage.setItem(KEY, JSON.stringify(state)).catch((error: unknown) =>
    console.warn("[guest] Data tamu tidak tersimpan:", error),
  );
}

export async function addGuestOwner(owner: GuestOwner) {
  await load();
  const owners = [owner, ...state.owners.filter((o) => o.inviteId !== owner.inviteId)];
  await save({ ...state, owners });
}

export async function removeGuestOwner(inviteId: string) {
  await load();
  const owner = state.owners.find((o) => o.inviteId === inviteId);
  const owners = state.owners.filter((o) => o.inviteId !== inviteId);
  // Peringatan dari pemilik itu ikut dihapus (nama dipakai karena hanya itu yang dikirim FCM)
  const stillWatched = new Set(owners.map((o) => o.ownerName));
  const alerts = owner
    ? state.alerts.filter((a) => a.ownerName !== owner.ownerName || stillWatched.has(a.ownerName))
    : state.alerts;
  await save({ owners, alerts });
}

export async function getGuestState() {
  await load();
  return state;
}

// Catat peringatan untuk tamu dari data notifikasi FCM. Diabaikan bila bukan untuk tamu.
export async function recordGuestAlert(data: Record<string, unknown> | undefined) {
  if (!data || data.url !== "/emergency-alert" || data.recipientType !== "guest") return;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "url" && (typeof value === "string" || typeof value === "number")) {
      params[key] = String(value);
    }
  }
  const id = params.notifId || `${params.targetUid ?? ""}_${params.timestampMs ?? ""}`;
  await load();
  if (state.alerts.some((a) => a.id === id)) return;
  const alert: GuestAlert = {
    id,
    ownerName: params.senderName || "Pengguna AirSense",
    parameter: params.parameter || "Kondisi sensor",
    value: params.value || "—",
    status: params.status || "warning",
    timestampMs: Number(params.timestampMs) || Date.now(),
    latitude: params.latitude,
    longitude: params.longitude,
    params,
  };
  const alerts = [alert, ...state.alerts]
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .slice(0, MAX_ALERTS);
  await save({ ...state, alerts });
}

// Peringatan yang masuk saat aplikasi tertutup masih ada di panel notifikasi -> catat
// saat aplikasi dibuka.
export async function collectPresentedGuestAlerts() {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      await recordGuestAlert(n.request.content.data as Record<string, unknown>);
    }
  } catch (error) {
    console.warn("[guest] Notifikasi di panel tidak terbaca:", error);
  }
}

export function useGuestState() {
  const [value, setValue] = React.useState<GuestState>(state);
  React.useEffect(() => {
    let active = true;
    listeners.add(setValue);
    void load().then(() => {
      if (active) setValue(state);
    });
    return () => {
      active = false;
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
