import { db, rtdb } from "@/lib/firebase";
import { subscribeLocalDevice, type LocalDevice } from "@/lib/local-device";
import { onValue, ref } from "firebase/database";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import React from "react";

export type DeviceState = LocalDevice;

export const EMPTY_DEVICE: DeviceState = {
  status: "offline",
  wearable_added: false,
  threshold_status: "normal",
  aqi: 0,
  pm25: 0,
  pm10: 0,
  co: 0,
  spo2: 0,
  bpm: 0,
};

// HP yang sedang menerima data wearable (BLE) selalu memakai nilai lokalnya. Selain itu
// dipakai yang paling baru di antara nilai lokal dan Realtime Database.
function pickDevice(local: DeviceState | null, remote: DeviceState | null) {
  if (!local) return remote;
  if (!remote || local.status === "online") return local;
  return (remote.received_at_ms ?? 0) > (local.received_at_ms ?? 0) ? remote : local;
}

// Nilai terkini wearable: salinan di HP (tersedia tanpa internet) + Realtime Database
// device/{uid} (untuk HP lain / kontak yang memantau).
export function useDevice(uid?: string | null) {
  // Nilai disimpan bersama uid-nya supaya data akun lama tidak ikut tampil saat uid berganti
  type Slot = { uid: string; value: DeviceState | null } | null;
  const [remote, setRemote] = React.useState<Slot>(null);
  const [local, setLocal] = React.useState<Slot>(null);
  React.useEffect(() => {
    if (!uid) return;
    const stopLocal = subscribeLocalDevice(uid, (value) => setLocal({ uid, value }));
    const stopRemote = onValue(
      ref(rtdb, `device/${uid}`),
      (snap) => setRemote({ uid, value: snap.val() as DeviceState | null }),
      () => setRemote({ uid, value: null }),
    );
    return () => {
      stopLocal();
      stopRemote();
    };
  }, [uid]);
  const device = React.useMemo(
    () =>
      pickDevice(
        local && local.uid === uid ? local.value : null,
        remote && remote.uid === uid ? remote.value : null,
      ),
    [local, remote, uid],
  );
  return { device };
}

// N pembacaan BPM terakhir dari Firestore (urut lama → baru)
export function useRecentBpm(uid?: string | null, n = 12) {
  const [values, setValues] = React.useState<number[]>([]);
  React.useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "profile", uid, "history"),
      orderBy("timestamp", "desc"),
      limit(n),
    );
    return onSnapshot(
      q,
      (snap) =>
        setValues(snap.docs.map((d) => d.data().bpm as number).reverse()),
      () => setValues([]),
    );
  }, [uid, n]);
  return values;
}

export type MonitoredUser = {
  monitoringId: string;
  target_uid: string;
  target_name: string;
  status: "pending" | "accepted";
};

// Pengguna yang meminta/mengizinkan saya memantau mereka
export function useMonitoring(uid?: string | null) {
  const [all, setAll] = React.useState<MonitoredUser[]>([]);
  React.useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      collection(db, "profile", uid, "monitoring"),
      (snap) => setAll(snap.docs.map((d) => d.data() as MonitoredUser)),
      () => setAll([]),
    );
  }, [uid]);
  return {
    accepted: all.filter((m) => m.status === "accepted"),
    pending: all.filter((m) => m.status === "pending"),
  };
}

export type Contact = {
  contactId: string;
  name: string;
  phone: string;
  type: "registered" | "guest";
  fcm_token: string;
  uid?: string;
  status: "pending" | "accepted" | "rejected";
};

// Orang-orang yang memantau saya (emergency_contacts)
export function useContacts(uid?: string | null) {
  const [list, setList] = React.useState<Contact[]>([]);
  React.useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      collection(db, "profile", uid, "emergency_contacts"),
      (snap) => setList(snap.docs.map((d) => d.data() as Contact)),
      () => setList([]),
    );
  }, [uid]);
  return list;
}
