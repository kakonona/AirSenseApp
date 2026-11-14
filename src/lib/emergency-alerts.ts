import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { auth } from "@/lib/firebase";
import { Timestamp } from "firebase/firestore";
import { enqueueWrite } from "@/lib/offline-queue";
import type { Reading } from "@/lib/device-data";
import { parameterThreshold, type AlertParameter } from "@/lib/thresholds";
import { EMERGENCY_CHANNEL_ID } from "@/lib/app-permissions";

type Coordinate = { latitude: number; longitude: number };
type Level = 0 | 1 | 2;
type MetricState = { notifiedLevel: Level; normalSince: number | null };
type PendingAlert = {
  eventId: string;
  parameter: AlertParameter;
  value: number;
  status: "warning" | "danger";
  timestampMs: number;
  sequence: number | null;
  location: Coordinate | null;
  locationCaptured: boolean;
};
type AlertState = {
  version: 1;
  metrics: Record<AlertParameter, MetricState>;
  pending: PendingAlert[];
};

const STATE_KEY_PREFIX = "airsense:emergency-alerts:v1:";
const NORMAL_REARM_MS = 30_000;
const LOCATION_FIX_TIMEOUT_MS = 20_000;
const LOCATION_FRESH_MS = 2 * 60_000; // lokasi cache dianggap masih terkini
const LOCATION_STALE_MAX_MS = 15 * 60_000; // lokasi lama lebih baik daripada tanpa lokasi
const API_TIMEOUT_MS = 15_000;
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 5 * 60_000;
const ALERT_API_URL = process.env.EXPO_PUBLIC_ALERT_API_URL?.replace(/\/+$/, "");
const queues = new Map<string, Promise<void>>();
const stateCache = new Map<string, AlertState>();

type PushRegistrationStage =
  | "permission"
  | "native-token"
  | "worker-config"
  | "firebase-auth"
  | "worker-network"
  | "worker-http";

class PushRegistrationError extends Error {
  constructor(
    readonly stage: PushRegistrationStage,
    message: string,
    readonly code?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PushRegistrationError";
  }
}

function redactDiagnostic(value: string) {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted JWT]")
    .replace(/\b[A-Za-z0-9:_-]{80,}\b/g, "[redacted value]")
    .slice(0, 300);
}

function pushFailure(stage: PushRegistrationStage, error: unknown) {
  if (error instanceof PushRegistrationError) return error;
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; name?: unknown })
      : undefined;
  const message =
    typeof candidate?.message === "string"
      ? candidate.message
      : typeof error === "string"
        ? error
        : "Kesalahan tidak dikenal.";
  const code =
    typeof candidate?.code === "string"
      ? redactDiagnostic(candidate.code)
      : undefined;
  const detail = redactDiagnostic(message);
  return new PushRegistrationError(
    stage,
    code ? `${detail} [${code}]` : detail,
    code,
  );
}

function logPushFailure(error: PushRegistrationError) {
  console.error("[FCM] Device registration failed.", {
    stage: error.stage,
    code: error.code,
    httpStatus: error.httpStatus,
    message: redactDiagnostic(error.message),
  });
  return new Error(
    `Tahap: ${error.stage}${error.httpStatus ? ` (HTTP ${error.httpStatus})` : ""}. ${error.message}`,
  );
}

async function alertApiRequest(
  endpoint: string,
  payload: Record<string, unknown>,
  authenticated = true,
) {
  if (!ALERT_API_URL) {
    throw new PushRegistrationError(
      "worker-config",
      "EXPO_PUBLIC_ALERT_API_URL belum disetel saat APK dibuat.",
    );
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authenticated) {
    const user = auth.currentUser;
    if (!user) {
      throw new PushRegistrationError(
        "firebase-auth",
        "Tidak ada sesi Firebase aktif.",
      );
    }
    try {
      headers.authorization = `Bearer ${await user.getIdToken()}`;
    } catch (error) {
      throw pushFailure("firebase-auth", error);
    }
  }
  let response: Response;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    response = await fetch(`${ALERT_API_URL}/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw pushFailure("worker-network", error);
  } finally {
    clearTimeout(abortTimer);
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result && typeof result === "object" && "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `Cloudflare Alert API gagal (${response.status}).`;
    throw new PushRegistrationError(
        "worker-http",
        redactDiagnostic(message),
        undefined,
        response.status,
    );
  }
  console.info("[FCM] Cloudflare Worker request succeeded.", {
    endpoint,
    httpStatus: response.status,
  });
  return result;
}

function severityLevel(status: "normal" | "warning" | "danger"): Level {
  if (status === "danger") return 2;
  if (status === "warning") return 1;
  return 0;
}

function emptyState(now: number): AlertState {
  return {
    version: 1,
    metrics: {
      SpO2: { notifiedLevel: 0, normalSince: now - NORMAL_REARM_MS },
      BPM: { notifiedLevel: 0, normalSince: now - NORMAL_REARM_MS },
      AQI: { notifiedLevel: 0, normalSince: now - NORMAL_REARM_MS },
    },
    pending: [],
  };
}

function isAlertState(value: unknown): value is AlertState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AlertState>;
  if (candidate.version !== 1 || !candidate.metrics || !Array.isArray(candidate.pending)) {
    return false;
  }
  return (["SpO2", "BPM", "AQI"] as const).every((parameter) => {
    const metric = candidate.metrics?.[parameter];
    return (
      !!metric &&
      (metric.notifiedLevel === 0 ||
        metric.notifiedLevel === 1 ||
        metric.notifiedLevel === 2) &&
      (metric.normalSince === null || Number.isFinite(metric.normalSince))
    );
  });
}

async function loadState(uid: string): Promise<AlertState> {
  const cached = stateCache.get(uid);
  if (cached) return cached;

  const raw = await AsyncStorage.getItem(`${STATE_KEY_PREFIX}${uid}`);
  if (raw === null) {
    const initial = emptyState(Date.now());
    stateCache.set(uid, initial);
    return initial;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("Could not parse persisted emergency alert state:", error);
    throw new Error("Data status alert tersimpan rusak.");
  }
  if (!isAlertState(parsed)) {
    throw new Error("Format status alert tersimpan tidak valid.");
  }
  stateCache.set(uid, parsed);
  return parsed;
}

async function saveState(uid: string, state: AlertState) {
  await AsyncStorage.setItem(
    `${STATE_KEY_PREFIX}${uid}`,
    JSON.stringify(state),
  );
}

function notificationContent(alert: PendingAlert) {
  const title =
    alert.parameter === "SpO2"
      ? "Peringatan SpO₂"
      : alert.parameter === "BPM"
        ? "Peringatan Denyut Jantung"
        : "Peringatan Kualitas Udara";
  const body =
    alert.parameter === "SpO2"
      ? `SpO₂ ${alert.value}% — ${alert.status === "danger" ? "kondisi kritis" : "di bawah 95%"}.`
      : alert.parameter === "BPM"
        ? `Denyut jantung ${alert.value} BPM, di luar rentang 60–100 BPM.`
        : `AQI ${alert.value}, melebihi ambang 100.`;
  return { title, body };
}

// URL peta statis di Worker (ada pin; butuh GEOAPIFY_API_KEY di Worker)
export function staticMapUrl(location: Coordinate | null) {
  if (!ALERT_API_URL || !location) return null;
  return `${ALERT_API_URL}/map?lat=${location.latitude.toFixed(5)}&lon=${location.longitude.toFixed(5)}`;
}

// Data yang dibawa notifikasi = data yang dibuka dari riwayat (isi sama persis)
function alertPayload(alert: PendingAlert, uid: string) {
  const { title, body } = notificationContent(alert);
  const data: Record<string, string> = {
    url: "/emergency-alert",
    notifId: alert.eventId,
    targetUid: uid,
    parameter: alert.parameter,
    value: String(alert.value),
    status: alert.status,
    recipientType: "owner",
    timestampMs: String(alert.timestampMs),
  };
  if (alert.location) {
    data.latitude = String(alert.location.latitude);
    data.longitude = String(alert.location.longitude);
  }
  const locationText = alert.location
    ? ` Lokasi: ${alert.location.latitude.toFixed(5)}, ${alert.location.longitude.toFixed(5)}`
    : "";
  return { title, body: `${body}${locationText}`, data };
}

async function showLocalAlert(alert: PendingAlert, uid: string) {
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") {
    console.warn("Local emergency notification skipped: permission not granted.");
    return;
  }
  const { title, body, data } = alertPayload(alert, uid);
  await Notifications.scheduleNotificationAsync({
    // identifier sama -> notifikasi diperbarui (mis. setelah lokasi didapat), bukan dobel
    identifier: alert.eventId,
    content: { title, body, sound: "default", data },
    trigger: null,
  });
}

// Simpan notifikasi ke Firestore: profile/{uid}/notifications/{eventId}
async function saveNotificationRecord(uid: string, alert: PendingAlert) {
  const { title, body, data } = alertPayload(alert, uid);
  // Lewat antrean offline: tetap tersimpan di HP walau tanpa sinyal, lalu disinkronkan
  await enqueueWrite(
    ["profile", uid, "notifications", alert.eventId],
    {
      notifId: alert.eventId,
      title,
      body,
      timestamp: Timestamp.fromMillis(alert.timestampMs),
      recorded_at: Timestamp.fromMillis(alert.timestampMs),
      parameter: alert.parameter,
      value: alert.value,
      status: alert.status,
      location: alert.location,
      map_url: staticMapUrl(alert.location),
      sequence: alert.sequence,
      direction: "own",
      recipientType: "owner",
      targetUid: uid,
      data,
    },
    true,
  );
}

function recordNotification(uid: string, alert: PendingAlert) {
  void saveNotificationRecord(uid, alert).catch((error: unknown) => {
    console.error("Could not save notification history:", error);
  });
}

// ── Lokasi ───────────────────────────────────────────────────────────────────
// Android membatasi pengambilan GPS baru dari background. Karena itu selama wearable
// terhubung (foreground service tipe location aktif), posisi dipantau terus dan
// disimpan di cache, sehingga saat alert muncul koordinat langsung tersedia.
let cachedFix: { coordinate: Coordinate; at: number } | null = null;
let locationWatch: Location.LocationSubscription | null = null;
let locationWatchStarting: Promise<void> | null = null;

function rememberFix(position: Location.LocationObject | null) {
  if (!position) return null;
  cachedFix = {
    coordinate: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    },
    at: position.timestamp || Date.now(),
  };
  return cachedFix.coordinate;
}

async function hasLocationAccess() {
  // Izin "saat digunakan" sudah cukup selama foreground service tipe location berjalan.
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status === "granted") return true;
  const background = await Location.getBackgroundPermissionsAsync();
  return background.status === "granted";
}

export function startLocationWatch(): Promise<void> {
  if (Platform.OS === "web" || locationWatch) return Promise.resolve();
  locationWatchStarting ??= (async () => {
    try {
      if (!(await hasLocationAccess())) {
        console.warn("[GPS] Pemantauan lokasi tidak aktif: izin lokasi belum diberikan.");
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        console.warn("[GPS] Pemantauan lokasi tidak aktif: layanan lokasi HP mati.");
        return;
      }
      rememberFix(await Location.getLastKnownPositionAsync().catch(() => null));
      locationWatch = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30_000,
          distanceInterval: 25,
        },
        rememberFix,
      );
    } catch (error) {
      console.warn("[GPS] Gagal memulai pemantauan lokasi:", error);
    } finally {
      locationWatchStarting = null;
    }
  })();
  return locationWatchStarting;
}

export function stopLocationWatch() {
  locationWatch?.remove();
  locationWatch = null;
}

async function captureLocation(): Promise<Coordinate | null> {
  const now = Date.now();
  if (cachedFix && now - cachedFix.at <= LOCATION_FRESH_MS) {
    return cachedFix.coordinate;
  }
  try {
    if (!(await hasLocationAccess())) {
      console.warn("Emergency event has no location: location permission not granted.");
      return null;
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      console.warn("Emergency event has no location: device location services are off.");
      return cachedFix?.coordinate ?? null;
    }

    const lastKnown = rememberFix(
      await Location.getLastKnownPositionAsync({ maxAge: LOCATION_FRESH_MS }).catch(
        () => null,
      ),
    );
    if (lastKnown) return lastKnown;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const fresh = rememberFix(
        await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), LOCATION_FIX_TIMEOUT_MS);
          }),
        ]),
      );
      if (fresh) return fresh;
    } catch (error) {
      console.warn("GPS fix failed, falling back to an older location:", error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    // Cadangan: lokasi lama (maks 15 menit) tetap lebih berguna bagi kontak darurat.
    if (cachedFix && now - cachedFix.at <= LOCATION_STALE_MAX_MS) {
      return cachedFix.coordinate;
    }
    const older = rememberFix(
      await Location.getLastKnownPositionAsync({ maxAge: LOCATION_STALE_MAX_MS }).catch(
        () => null,
      ),
    );
    if (older) return older;
    console.warn("Emergency event has no location: GPS fix timed out.");
    return null;
  } catch (error) {
    console.warn("Could not capture emergency location; alert delivery will continue:", error);
    return cachedFix?.coordinate ?? null;
  }
}

function createPendingAlert(
  parameter: AlertParameter,
  value: number,
  status: "warning" | "danger",
  timestampMs: number,
  sequence: number | null,
): PendingAlert {
  const suffix = Math.random().toString(36).slice(2, 10);
  return {
    eventId: `a${timestampMs.toString(36)}_${sequence ?? 0}_${parameter}_${suffix}`,
    parameter,
    value,
    status,
    timestampMs,
    sequence,
    location: null,
    locationCaptured: false,
  };
}

// Status HTTP yang tidak akan berhasil walau dicoba ulang -> event dibuang agar
// tidak memblokir antrean alert berikutnya.
function isPermanentFailure(error: unknown) {
  return (
    error instanceof PushRegistrationError &&
    error.stage === "worker-http" &&
    error.httpStatus !== undefined &&
    [400, 404, 409, 410, 412, 413].includes(error.httpStatus)
  );
}

const retryState = new Map<
  string,
  { attempts: number; nextAt: number; timer: ReturnType<typeof setTimeout> | null }
>();

function scheduleRetry(uid: string) {
  const current = retryState.get(uid) ?? { attempts: 0, nextAt: 0, timer: null };
  current.attempts += 1;
  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (current.attempts - 1));
  current.nextAt = Date.now() + delay;
  if (current.timer) clearTimeout(current.timer);
  // Coba ulang walau tidak ada frame BLE baru (ESP sedang deep sleep 120 dtk)
  current.timer = setTimeout(() => {
    current.timer = null;
    void enqueue(uid, async () => {
      const state = await loadState(uid);
      await flushPendingAlerts(uid, state, true);
    });
  }, delay);
  retryState.set(uid, current);
}

function clearRetry(uid: string) {
  const current = retryState.get(uid);
  if (current?.timer) clearTimeout(current.timer);
  retryState.delete(uid);
}

async function flushPendingAlerts(uid: string, state: AlertState, force = false) {
  if (state.pending.length === 0) {
    clearRetry(uid);
    return;
  }
  const retry = retryState.get(uid);
  if (!force && retry && Date.now() < retry.nextAt) return; // tunggu jadwal coba ulang

  try {
    const uncaptured = state.pending.filter((event) => !event.locationCaptured);
    if (uncaptured.length > 0) {
      const location = await captureLocation();
      for (const event of uncaptured) {
        const hadLocation = !!event.location;
        event.location ??= location;
        event.locationCaptured = true;
        if (!hadLocation && event.location) {
          // Notifikasi lokal & riwayat diperbarui dengan koordinat
          recordNotification(uid, event);
          void showLocalAlert(event, uid).catch((error: unknown) => {
            console.error("Could not update local alert with location:", error);
          });
        }
      }
      await saveState(uid, state);
    }

    while (state.pending.length > 0) {
      const event = state.pending[0];
      // Lokasi belum didapat saat alert dibuat -> coba lagi sebelum dikirim ulang
      if (!event.location) event.location = await captureLocation();
      try {
        await alertApiRequest("reportEmergencyAlert", { ...event, uid });
      } catch (error) {
        if (!isPermanentFailure(error)) throw error;
        console.error("Emergency alert dropped (permanent failure):", error);
      }
      state.pending.shift();
      await saveState(uid, state);
    }
    clearRetry(uid);
  } catch (error) {
    console.warn("Emergency alert delivery is pending and will be retried:", error);
    scheduleRetry(uid);
  }
}

async function processReading(uid: string, reading: Reading, timestampMs: number) {
  const state = await loadState(uid);
  const readings: Record<AlertParameter, number | null> = {
    SpO2: reading.spo2,
    BPM: reading.bpm,
    AQI: reading.aqi,
  };
  const newAlerts: PendingAlert[] = [];

  for (const parameter of ["SpO2", "BPM", "AQI"] as const) {
    const metric = state.metrics[parameter];
    const value = readings[parameter];
    if (value === null) continue;
    const status = parameterThreshold(parameter, value);
    const level = severityLevel(status);

    if (level === 0) {
      if (metric.normalSince === null) metric.normalSince = timestampMs;
      if (timestampMs - metric.normalSince >= NORMAL_REARM_MS) {
        metric.notifiedLevel = 0;
      }
      continue;
    }

    if (metric.normalSince !== null) {
      if (timestampMs - metric.normalSince >= NORMAL_REARM_MS) {
        metric.notifiedLevel = 0;
      }
      metric.normalSince = null;
    }
    if (level <= metric.notifiedLevel) continue;

    metric.notifiedLevel = level;
    newAlerts.push(
      createPendingAlert(
        parameter,
        value,
        status === "danger" ? "danger" : "warning",
        timestampMs,
        reading.seq ?? null,
      ),
    );
  }

  // Lokasi cepat dari cache (pemantauan GPS) supaya notifikasi langsung berisi koordinat
  const quick =
    cachedFix && Date.now() - cachedFix.at <= LOCATION_FRESH_MS
      ? cachedFix.coordinate
      : null;
  for (const alert of newAlerts) {
    if (quick) {
      alert.location = quick;
      alert.locationCaptured = true;
    }
  }
  state.pending.push(...newAlerts);
  await saveState(uid, state);

  for (const alert of newAlerts) {
    recordNotification(uid, alert);
    try {
      await showLocalAlert(alert, uid);
    } catch (error) {
      console.error(`Could not show local ${alert.parameter} alert:`, error);
    }
  }
  await flushPendingAlerts(uid, state);
}

function enqueue(uid: string, task: () => Promise<void>): Promise<void> {
  const previous = queues.get(uid) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(uid, next);
  return next.finally(() => {
    if (queues.get(uid) === next) queues.delete(uid);
  });
}

export function processReadingAlerts(
  uid: string,
  reading: Reading,
  timestampMs: number,
): Promise<void> {
  void startLocationWatch();
  return enqueue(uid, () => processReading(uid, reading, timestampMs));
}

export async function getDevicePushToken() {
  if (Platform.OS === "web") {
    throw new PushRegistrationError(
      "native-token",
      "FCM device token hanya tersedia di aplikasi Android/iOS.",
    );
  }
  let permission: Notifications.NotificationPermissionsStatus;
  try {
    permission = await Notifications.getPermissionsAsync();
  } catch (error) {
    throw pushFailure("permission", error);
  }
  if (permission.status !== "granted") {
    throw new PushRegistrationError(
      "permission",
      `Izin notifikasi belum diberikan (status: ${permission.status}).`,
    );
  }
  let token: Notifications.DevicePushToken;
  try {
    token = await Notifications.getDevicePushTokenAsync();
  } catch (error) {
    throw pushFailure("native-token", error);
  }
  if (typeof token.data !== "string" || token.data.length < 20) {
    throw new PushRegistrationError(
      "native-token",
      "Firebase tidak mengembalikan device push token yang valid.",
    );
  }
  console.info("[FCM] Native device token acquired; token value is not logged.");
  return token.data;
}

let tokenListener: Notifications.EventSubscription | null = null;

// Token FCM bisa berganti (update app, data dihapus, rotasi Google). Tanpa ini
// pengirim/kontak darurat tetap memakai token lama dan notifikasi gagal terkirim.
export function watchPushTokenChanges() {
  if (Platform.OS === "web" || tokenListener) return () => {};
  tokenListener = Notifications.addPushTokenListener(() => {
    void registerAuthenticatedPushToken().catch((error: unknown) => {
      console.error("[FCM] Re-registration after token change failed:", error);
    });
  });
  return () => {
    tokenListener?.remove();
    tokenListener = null;
  };
}

export async function registerAuthenticatedPushToken() {
  try {
    const token = await getDevicePushToken();
    await alertApiRequest("registerPushToken", { token, platform: Platform.OS });
    console.info("[FCM] Device registration completed; token value is not logged.");
  } catch (error) {
    throw logPushFailure(pushFailure("worker-network", error));
  }
}

export async function createGuestInvitation(name: string) {
  const result = await alertApiRequest("createInvitation", { name });
  if (
    !result ||
    typeof result !== "object" ||
    !("link" in result) ||
    typeof result.link !== "string"
  ) {
    throw new Error("Cloudflare Alert API tidak mengembalikan tautan undangan.");
  }
  return result.link;
}

export async function acceptGuestInvitation(
  inviteId: string,
  name: string,
) {
  const token = await getDevicePushToken();
  await alertApiRequest(
    "acceptGuestInvitation",
    { inviteId, name, token },
    false,
  );
}

export { EMERGENCY_CHANNEL_ID };
