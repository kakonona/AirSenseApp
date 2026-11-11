import { db, rtdb } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import React from "react";

export type DeviceState = {
  status: "online" | "offline";
  wearable_added?: boolean;
  threshold_status: "normal" | "warning" | "danger";
  aqi: number;
  pm25: number;
  pm10: number;
  co: number;
  spo2: number;
  bpm: number;
};

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

// Nilai terkini dari Realtime Database: device/{uid}
export function useDevice(uid?: string | null) {
  const [device, setDevice] = React.useState<DeviceState | null>(null);
  React.useEffect(() => {
    if (!uid) return;
    return onValue(
      ref(rtdb, `device/${uid}`),
      (snap) => setDevice(snap.val() as DeviceState | null),
      () => setDevice(null),
    );
  }, [uid]);
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
