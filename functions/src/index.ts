import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

const db = getFirestore();
const REGION = "asia-southeast1";
const PARAMETERS = ["SpO2", "BPM", "AQI"] as const;
type Parameter = (typeof PARAMETERS)[number];
type Severity = "warning" | "danger";
type Coordinate = { latitude: number; longitude: number };

function requireString(value: unknown, field: string, maximumLength = 4096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new HttpsError("invalid-argument", `${field} tidak valid.`);
  }
  return value;
}

function requireToken(value: unknown) {
  const token = requireString(value, "token");
  if (token.length < 20) {
    throw new HttpsError("invalid-argument", "Device push token tidak valid.");
  }
  return token;
}

function tokenId(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function validateAlert(parameterValue: unknown, rawValue: unknown, rawStatus: unknown) {
  if (!PARAMETERS.includes(parameterValue as Parameter)) {
    throw new HttpsError("invalid-argument", "Parameter alert tidak didukung.");
  }
  const parameter = parameterValue as Parameter;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new HttpsError("invalid-argument", "Nilai sensor tidak valid.");
  }

  const status: Severity | null =
    parameter === "SpO2"
      ? rawValue < 90
        ? "danger"
        : rawValue < 95
          ? "warning"
          : null
      : parameter === "BPM"
        ? rawValue < 60 || rawValue > 100
          ? "warning"
          : null
        : rawValue > 100
          ? "warning"
          : null;

  if (status === null || rawStatus !== status) {
    throw new HttpsError(
      "failed-precondition",
      "Nilai sensor tidak melewati ambang alert yang dikonfigurasi.",
    );
  }
  if (
    (parameter === "SpO2" && (rawValue < 50 || rawValue > 100)) ||
    (parameter === "BPM" && (rawValue < 20 || rawValue > 250)) ||
    (parameter === "AQI" && (rawValue < 0 || rawValue > 500))
  ) {
    throw new HttpsError("invalid-argument", "Nilai sensor di luar rentang.");
  }
  return { parameter, value: rawValue, status };
}

function readLocation(value: unknown): Coordinate | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") {
    throw new HttpsError("invalid-argument", "Koordinat lokasi tidak valid.");
  }
  const candidate = value as Partial<Coordinate>;
  if (
    typeof candidate.latitude !== "number" ||
    typeof candidate.longitude !== "number" ||
    !Number.isFinite(candidate.latitude) ||
    !Number.isFinite(candidate.longitude) ||
    candidate.latitude < -90 ||
    candidate.latitude > 90 ||
    candidate.longitude < -180 ||
    candidate.longitude > 180
  ) {
    throw new HttpsError("invalid-argument", "Koordinat lokasi tidak valid.");
  }
  return { latitude: candidate.latitude, longitude: candidate.longitude };
}

function alertCopy(parameter: Parameter, value: number, status: Severity) {
  const severity = status === "danger" ? "KRITIS" : "PERINGATAN";
  if (parameter === "SpO2") {
    return {
      title: `${severity}: SpO₂`,
      body: `SpO₂ pengemudi ${value}%. Periksa kondisi dan lokasi kejadian.`,
    };
  }
  if (parameter === "BPM") {
    return {
      title: `${severity}: Denyut jantung`,
      body: `Denyut jantung pengemudi ${value} BPM, di luar rentang aman.`,
    };
  }
  return {
    title: `${severity}: Kualitas udara`,
    body: `AQI pengemudi ${value}, melebihi ambang 100.`,
  };
}

export const registerPushToken = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk terlebih dahulu.");
  }
  const token = requireToken(request.data?.token);
  const uid = request.auth.uid;
  const tokenRef = db
    .collection("profile")
    .doc(uid)
    .collection("push_tokens")
    .doc(tokenId(token));

  await tokenRef.set({
    token,
    updated_at: FieldValue.serverTimestamp(),
    platform: request.data?.platform === "ios" ? "ios" : "android",
  });

  const contactDocs = await db
    .collectionGroup("emergency_contacts")
    .where("uid", "==", uid)
    .get();
  const writer = db.bulkWriter();
  for (const contact of contactDocs.docs) {
    if (contact.get("type") === "registered") {
      writer.update(contact.ref, { fcm_token: token });
    }
  }
  await writer.close();
  return { registered: true };
});

export const acceptGuestInvitation = onCall(
  { region: REGION },
  async (request) => {
    const inviteId = requireString(request.data?.inviteId, "inviteId", 128);
    const token = requireToken(request.data?.token);
    const name =
      typeof request.data?.name === "string" && request.data.name.trim()
        ? request.data.name.trim().slice(0, 80)
        : "Tamu";
    const inviteRef = db.collection("invitations").doc(inviteId);
    const invitation = await inviteRef.get();
    if (!invitation.exists) {
      throw new HttpsError("not-found", "Undangan tidak ditemukan.");
    }

    const tokenHash = tokenId(token);
    const contactId = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(inviteRef);
      const data = current.data();
      if (!data) throw new HttpsError("not-found", "Undangan tidak ditemukan.");
      if (
        data.used === true &&
        data.guest_token_hash === tokenHash &&
        typeof data.guest_contact_id === "string"
      ) {
        return data.guest_contact_id;
      }
      if (data.used === true) {
        throw new HttpsError("failed-precondition", "Undangan sudah digunakan.");
      }
      if (
        !(data.expires_at instanceof Timestamp) ||
        data.expires_at.toMillis() <= Date.now()
      ) {
        throw new HttpsError("deadline-exceeded", "Undangan sudah kedaluwarsa.");
      }
      const ownerUid = requireString(data.inviter_uid, "inviter_uid", 128);
      const contactRef = db
        .collection("profile")
        .doc(ownerUid)
        .collection("emergency_contacts")
        .doc();
      transaction.set(contactRef, {
        contactId: contactRef.id,
        name,
        phone: "",
        type: "guest",
        fcm_token: token,
        uid: contactRef.id,
        status: "accepted",
      });
      transaction.update(inviteRef, {
        used: true,
        used_at: FieldValue.serverTimestamp(),
        guest_token_hash: tokenHash,
        guest_contact_id: contactRef.id,
      });
      return contactRef.id;
    });

    return { accepted: true, contactId };
  },
);

export const reportEmergencyAlert = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Silakan masuk terlebih dahulu.");
    }
    const uid = request.auth.uid;
    const eventId = requireString(request.data?.eventId, "eventId", 128);
    if (!/^[A-Za-z0-9_-]+$/.test(eventId)) {
      throw new HttpsError("invalid-argument", "ID alert tidak valid.");
    }
    const { parameter, value, status } = validateAlert(
      request.data?.parameter,
      request.data?.value,
      request.data?.status,
    );
    const location = readLocation(request.data?.location);
    const sequence =
      Number.isInteger(request.data?.sequence) &&
      request.data.sequence >= 0 &&
      request.data.sequence <= 65535
        ? request.data.sequence
        : null;
    const timestampMs =
      typeof request.data?.timestampMs === "number" &&
      Number.isFinite(request.data.timestampMs) &&
      request.data.timestampMs <= Date.now() + 60_000
        ? request.data.timestampMs
        : Date.now();
    const alertRef = db
      .collection("profile")
      .doc(uid)
      .collection("notifications")
      .doc(eventId);

    const shouldDeliver = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(alertRef);
      if (existing.exists) {
        return existing.get("delivery.status") !== "sent";
      }
      transaction.create(alertRef, {
        notifId: eventId,
        timestamp: FieldValue.serverTimestamp(),
        recorded_at: Timestamp.fromMillis(timestampMs),
        parameter,
        value,
        status,
        location,
        sequence,
        delivery: { status: "pending", attempted: 0, sent: 0, failed: 0 },
      });
      return true;
    });
    if (!shouldDeliver) return { notifId: eventId, duplicate: true };

    const contacts = await db
      .collection("profile")
      .doc(uid)
      .collection("emergency_contacts")
      .where("status", "==", "accepted")
      .get();
    const recipients = new Map<
      string,
      { token: string; tokenRef?: DocumentReference; type: string }
    >();
    for (const contact of contacts.docs) {
      const data = contact.data();
      if (data.type === "guest" && typeof data.fcm_token === "string") {
        const token = data.fcm_token;
        recipients.set(tokenId(token), { token, tokenRef: contact.ref, type: "guest" });
      } else if (data.type === "registered" && typeof data.uid === "string") {
        const tokens = await db
          .collection("profile")
          .doc(data.uid)
          .collection("push_tokens")
          .get();
        for (const tokenDoc of tokens.docs) {
          const token = tokenDoc.get("token");
          if (typeof token === "string") {
            recipients.set(tokenId(token), {
              token,
              tokenRef: tokenDoc.ref,
              type: "registered",
            });
          }
        }
      }
    }

    const deliveredHashes = new Set<string>(
      (await alertRef.get()).get("delivery.sentTokenHashes") ?? [],
    );
    const pendingRecipients = [...recipients.entries()].filter(
      ([hash]) => !deliveredHashes.has(hash),
    );
    const copy = alertCopy(parameter, value, status);
    const messageResults = await Promise.all(
      pendingRecipients.map(async ([hash, recipient]) => {
        try {
          await getMessaging().send({
            token: recipient.token,
            notification: copy,
            data: {
              url: "/emergency-alert",
              targetUid: uid,
              notifId: eventId,
              parameter,
              value: String(value),
              status,
              recipientType: recipient.type,
              ...(location
                ? {
                    latitude: String(location.latitude),
                    longitude: String(location.longitude),
                  }
                : {}),
            },
            android: {
              priority: "high",
              ttl: 60 * 60 * 1000,
              notification: {
                channelId: "emergency-alerts",
                sound: "default",
              },
            },
            apns: {
              headers: { "apns-priority": "10" },
              payload: { aps: { sound: "default" } },
            },
          });
          return { hash, recipient, sent: true, errorCode: undefined };
        } catch (error) {
          const errorCode = (error as { code?: string }).code;
          logger.error("FCM emergency delivery failed", {
            uid,
            eventId,
            parameter,
            tokenId: hash,
            error,
          });
          return { hash, recipient, sent: false, errorCode };
        }
      }),
    );

    const sentHashes = messageResults
      .filter((result) => result.sent)
      .map((result) => result.hash);
    const invalidTokens = messageResults.filter(
      (result) =>
        !result.sent &&
        result.errorCode === "messaging/registration-token-not-registered",
    );
    for (const result of invalidTokens) {
      if (result.recipient.tokenRef) {
        if (result.recipient.type === "guest") {
          await result.recipient.tokenRef.update({ fcm_token: "" });
        } else {
          await result.recipient.tokenRef.delete();
        }
      }
    }

    const sent = sentHashes.length;
    const failed = messageResults.length - sent;
    const sentTokenUpdate =
      sentHashes.length > 0
        ? { "delivery.sentTokenHashes": FieldValue.arrayUnion(...sentHashes) }
        : {};
    await alertRef.update({
      "delivery.status":
        messageResults.length === 0
          ? "no_recipients"
          : failed === 0
            ? "sent"
            : sent > 0
              ? "partial"
              : "failed",
      "delivery.attempted": FieldValue.increment(messageResults.length),
      "delivery.sent": FieldValue.increment(sent),
      "delivery.failed": FieldValue.increment(failed),
      "delivery.updated_at": FieldValue.serverTimestamp(),
      ...sentTokenUpdate,
    });
    return { notifId: eventId, duplicate: false, sent, failed };
  },
);
