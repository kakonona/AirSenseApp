export interface Env {
  FIREBASE_PROJECT_ID: string;
  GOOGLE_SERVICE_ACCOUNT: string;
  // Opsional: key gratis dari geoapify.com untuk gambar peta di notifikasi
  GEOAPIFY_API_KEY?: string;
}

type JsonMap = Record<string, unknown>;
type TimestampField = { _firestoreTimestamp: string };
type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
};
type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values: FirestoreValue[] } }
  | { mapValue: { fields: Record<string, FirestoreValue> } };
type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};
type Coordinate = { latitude: number; longitude: number };
type AlertParameter = "SpO2" | "BPM" | "AQI";
type AlertSeverity = "warning" | "danger";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TOKEN_ISSUER = "https://securetoken.google.com";
const TOKEN_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const enc = new TextEncoder();
let cachedServiceToken: { value: string; expiresAt: number } | null = null;
let cachedJwks: { keys: JsonWebKey[]; expiresAt: number } | null = null;

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function errorResponse(error: unknown, origin: string | null) {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError("Layanan alert sedang bermasalah.", 500);
  if (apiError.status >= 500) {
    console.error("Alert API request failed:", error);
  }
  return json(
    { error: apiError.message },
    apiError.status,
    corsHeaders(origin),
  );
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function asTimestamp(value: number | Date): TimestampField {
  return { _firestoreTimestamp: new Date(value).toISOString() };
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseJsonPart(value: string): JsonMap {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object");
    }
    return parsed as JsonMap;
  } catch {
    throw new ApiError("Token tidak valid.", 401);
  }
}

function validDocumentId(value: string) {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

async function firebasePublicKeys() {
  if (cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const response = await fetch(TOKEN_JWKS_URL);
  if (!response.ok) throw new ApiError("Tidak dapat memverifikasi sesi Firebase.", 503);
  const body = (await response.json()) as { keys?: JsonWebKey[] };
  if (!body.keys?.length) throw new ApiError("Kunci verifikasi Firebase kosong.", 503);
  const maxAge = response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1];
  cachedJwks = {
    keys: body.keys,
    expiresAt: Date.now() + Math.max(60, Number(maxAge ?? 3600)) * 1000,
  };
  return cachedJwks.keys;
}

async function verifyFirebaseToken(request: Request, projectId: string) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token || token.length > 16_384) {
    throw new ApiError("Sesi Firebase diperlukan.", 401);
  }
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError("Token tidak valid.", 401);
  const header = parseJsonPart(parts[0]);
  const claims = parseJsonPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new ApiError("Token tidak valid.", 401);
  }
  const key = (await firebasePublicKeys()).find(
    (candidate) => (candidate as JsonWebKey & { kid?: string }).kid === header.kid,
  );
  if (!key) throw new ApiError("Token tidak valid.", 401);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(parts[2]),
    enc.encode(`${parts[0]}.${parts[1]}`),
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !validSignature ||
    claims.aud !== projectId ||
    claims.iss !== `${TOKEN_ISSUER}/${projectId}` ||
    typeof claims.sub !== "string" ||
    !validDocumentId(claims.sub) ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds ||
    typeof claims.iat !== "number" ||
    claims.iat > nowSeconds + 300
  ) {
    throw new ApiError("Sesi Firebase tidak valid atau kedaluwarsa.", 401);
  }
  return claims.sub;
}

function field(value: unknown): FirestoreValue {
  if (
    value &&
    typeof value === "object" &&
    "_firestoreTimestamp" in value &&
    typeof value._firestoreTimestamp === "string"
  ) {
    return { timestampValue: value._firestoreTimestamp };
  }
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(field) } };
  }
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, child]) => [key, field(child)]),
        ),
      },
    };
  }
  throw new ApiError("Tipe data Firestore tidak didukung.", 500);
}

function fields(values: JsonMap) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, field(value)]),
  );
}

function unfield(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(unfield);
  if ("mapValue" in value) return unfields(value.mapValue.fields ?? {});
  return null;
}

function unfields(values: Record<string, FirestoreValue> = {}): JsonMap {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, unfield(value)]),
  );
}

function documentPath(projectId: string, path: string) {
  return `projects/${projectId}/databases/(default)/documents/${path}`;
}

function googleApiError(message: string, status: number) {
  const mappedStatus =
    status === 401 || status === 403
      ? 503
      : status === 404
        ? 404
        : status >= 500
          ? 503
          : status;
  return new ApiError(message, mappedStatus);
}

async function serviceAccount(env: Env): Promise<ServiceAccount> {
  try {
    const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT) as ServiceAccount;
    if (
      typeof account.client_email !== "string" ||
      typeof account.private_key !== "string" ||
      account.project_id !== env.FIREBASE_PROJECT_ID
    ) {
      throw new Error("Invalid service account configuration");
    }
    return account;
  } catch {
    throw new ApiError("Cloudflare belum memiliki secret service account yang valid.", 503);
  }
}

async function googleAccessToken(env: Env) {
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) {
    return cachedServiceToken.value;
  }
  const account = await serviceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const encodedClaims = base64Url(
    enc.encode(
      JSON.stringify({
        iss: account.client_email,
        scope: `${FIRESTORE_SCOPE} ${FCM_SCOPE}`,
        aud: OAUTH_URL,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const unsigned = `${encodedHeader}.${encodedClaims}`;
  const pem = account.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64Url(pem.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    enc.encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !payload.access_token) {
    throw googleApiError("Google menolak kredensial Cloudflare Worker.", response.status);
  }
  cachedServiceToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
  };
  return cachedServiceToken.value;
}

async function googleFetch(env: Env, url: string, init?: RequestInit) {
  const token = await googleAccessToken(env);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw googleApiError(
      `Google API request failed (${response.status}): ${errorText.slice(0, 500)}`,
      response.status,
    );
  }
  return response;
}

function firestoreUrl(env: Env, path: string) {
  return `https://firestore.googleapis.com/v1/${documentPath(env.FIREBASE_PROJECT_ID, path)}`;
}

async function getDocument(env: Env, path: string) {
  const response = await fetch(firestoreUrl(env, path), {
    headers: { authorization: `Bearer ${await googleAccessToken(env)}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = await response.text();
    throw googleApiError(
      `Firestore read failed (${response.status}): ${errorText.slice(0, 500)}`,
      response.status,
    );
  }
  return (await response.json()) as FirestoreDocument;
}

async function listCollection(env: Env, path: string) {
  const documents: FirestoreDocument[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(firestoreUrl(env, path));
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await googleFetch(env, url.toString());
    const page = (await response.json()) as {
      documents?: FirestoreDocument[];
      nextPageToken?: string;
    };
    documents.push(...(page.documents ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && documents.length < 500);
  return documents;
}

async function createDocument(env: Env, collectionPath: string, id: string, data: JsonMap) {
  const url = new URL(firestoreUrl(env, collectionPath));
  url.searchParams.set("documentId", id);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await googleAccessToken(env)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields: fields(data) }),
  });
  if (response.status === 409 || response.status === 400) {
    const text = await response.text();
    if (/already exists|ALREADY_EXISTS|document exists/i.test(text)) return false;
    throw googleApiError(`Firestore create failed: ${text.slice(0, 500)}`, response.status);
  }
  if (!response.ok) {
    const text = await response.text();
    throw googleApiError(`Firestore create failed: ${text.slice(0, 500)}`, response.status);
  }
  return true;
}

async function patchDocument(
  env: Env,
  path: string,
  data: JsonMap,
  updateMask = Object.keys(data),
  updateTime?: string,
) {
  const url = new URL(firestoreUrl(env, path));
  for (const fieldPath of updateMask) {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  }
  if (updateTime) url.searchParams.set("currentDocument.updateTime", updateTime);
  const response = await googleFetch(env, url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: fields(data) }),
  });
  return (await response.json()) as FirestoreDocument;
}

async function commitGuestAcceptance(
  env: Env,
  invitation: FirestoreDocument,
  inviteId: string,
  contactPath: string,
  contact: JsonMap,
  invitationFields: JsonMap,
) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await googleAccessToken(env)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: documentPath(env.FIREBASE_PROJECT_ID, contactPath),
            fields: fields(contact),
          },
          currentDocument: { exists: false },
        },
        {
          update: {
            name: documentPath(env.FIREBASE_PROJECT_ID, `invitations/${inviteId}`),
            fields: fields(invitationFields),
          },
          updateMask: { fieldPaths: Object.keys(invitationFields) },
          currentDocument: { updateTime: invitation.updateTime },
        },
      ],
    }),
  });
  if (response.status === 409 || response.status === 400 || response.status === 404) {
    const text = await response.text();
    throw googleApiError(`Undangan berubah atau sudah digunakan: ${text.slice(0, 300)}`, 409);
  }
  if (!response.ok) {
    const text = await response.text();
    throw googleApiError(`Firestore commit failed: ${text.slice(0, 500)}`, response.status);
  }
}

function requiredString(value: unknown, name: string, maxLength = 4096) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ApiError(`${name} tidak valid.`, 400);
  }
  return value;
}

function requiredToken(value: unknown) {
  const token = requiredString(value, "FCM token");
  if (token.length < 20) throw new ApiError("FCM token tidak valid.", 400);
  return token;
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBody(request: Request): Promise<JsonMap> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_768) throw new ApiError("Request terlalu besar.", 413);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("Body JSON tidak valid.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("Body request tidak valid.", 400);
  }
  return body as JsonMap;
}

async function registerPushToken(request: Request, env: Env) {
  const uid = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
  const body = await readBody(request);
  const token = requiredToken(body.token);
  const tokenId = await sha256(token);
  await patchDocument(env, `profile/${uid}/push_tokens/${tokenId}`, {
    uid,
    token,
    platform: body.platform === "ios" ? "ios" : "android",
    updated_at: asTimestamp(Date.now()),
  });
  return { registered: true };
}

async function createInvitation(request: Request, env: Env) {
  const uid = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
  const body = await readBody(request);
  const inviterName =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 80)
      : "Pengguna AirSense";
  const inviteId = crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  await createDocument(env, "invitations", inviteId, {
    inviteId,
    inviter_uid: uid,
    inviter_name: inviterName,
    created_at: asTimestamp(now),
    expires_at: asTimestamp(now + 24 * 60 * 60 * 1000),
    used: false,
  });
  return { inviteId, link: `airsenseapp://invite/${inviteId}` };
}

async function acceptGuestInvitation(request: Request, env: Env) {
  const body = await readBody(request);
  const inviteId = requiredString(body.inviteId, "inviteId", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(inviteId)) {
    throw new ApiError("ID undangan tidak valid.", 400);
  }
  const token = requiredToken(body.token);
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 80)
      : "Tamu";
  const invitation = await getDocument(env, `invitations/${inviteId}`);
  if (!invitation) throw new ApiError("Undangan tidak ditemukan.", 404);
  const data = unfields(invitation.fields);
  const tokenHash = await sha256(token);
  if (
    data.used === true &&
    data.guest_token_hash === tokenHash &&
    typeof data.guest_contact_id === "string"
  ) {
    return { accepted: true, contactId: data.guest_contact_id };
  }
  if (data.used === true) throw new ApiError("Undangan sudah digunakan.", 409);
  if (
    typeof data.expires_at !== "string" ||
    Date.parse(data.expires_at) <= Date.now()
  ) {
    throw new ApiError("Undangan sudah kedaluwarsa.", 410);
  }
  const ownerUid = requiredString(data.inviter_uid, "inviter_uid", 128);
  if (!validDocumentId(ownerUid)) {
    throw new ApiError("Pemilik undangan tidak valid.", 400);
  }
  const contactId = crypto.randomUUID();
  const contactPath = `profile/${ownerUid}/emergency_contacts/${contactId}`;
  try {
    await commitGuestAcceptance(
      env,
      invitation,
      inviteId,
      contactPath,
      {
        contactId,
        name,
        phone: "",
        type: "guest",
        fcm_token: token,
        uid: contactId,
        status: "accepted",
      },
      {
        used: true,
        used_at: asTimestamp(Date.now()),
        guest_token_hash: tokenHash,
        guest_contact_id: contactId,
      },
    );
  } catch (error) {
    const latest = await getDocument(env, `invitations/${inviteId}`);
    const latestData = latest ? unfields(latest.fields) : {};
    if (
      latestData.guest_token_hash === tokenHash &&
      typeof latestData.guest_contact_id === "string"
    ) {
      return { accepted: true, contactId: latestData.guest_contact_id };
    }
    throw error;
  }
  return { accepted: true, contactId };
}

function validateAlert(body: JsonMap) {
  const parameter = body.parameter;
  if (!isAlertParameter(parameter)) {
    throw new ApiError("Parameter alert tidak didukung.", 400);
  }
  const value = body.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError("Nilai sensor tidak valid.", 400);
  }
  const status: AlertSeverity | null =
    parameter === "SpO2"
      ? value < 90
        ? "danger"
        : value < 95
          ? "warning"
          : null
      : parameter === "BPM"
        ? value < 60 || value > 100
          ? "warning"
          : null
        : value > 100
          ? "warning"
          : null;
  if (status === null || body.status !== status) {
    throw new ApiError("Nilai sensor tidak melewati ambang alert.", 412);
  }
  if (
    (parameter === "SpO2" && (value < 50 || value > 100)) ||
    (parameter === "BPM" && (value < 20 || value > 250)) ||
    (parameter === "AQI" && (value < 0 || value > 500))
  ) {
    throw new ApiError("Nilai sensor di luar rentang.", 400);
  }
  let location: Coordinate | null = null;
  if (body.location !== null && body.location !== undefined) {
    if (!body.location || typeof body.location !== "object") {
      throw new ApiError("Koordinat lokasi tidak valid.", 400);
    }
    const candidate = body.location as Partial<Coordinate>;
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
      throw new ApiError("Koordinat lokasi tidak valid.", 400);
    }
    location = { latitude: candidate.latitude, longitude: candidate.longitude };
  }
  const sequence =
    Number.isInteger(body.sequence) && Number(body.sequence) >= 0 && Number(body.sequence) <= 65535
      ? Number(body.sequence)
      : null;
  const timestampMs =
    typeof body.timestampMs === "number" &&
    Number.isFinite(body.timestampMs) &&
    body.timestampMs <= Date.now() + 60_000
      ? body.timestampMs
      : Date.now();
  return { parameter, value, status, location, sequence, timestampMs };
}

function isAlertParameter(value: unknown): value is AlertParameter {
  return value === "SpO2" || value === "BPM" || value === "AQI";
}

function alertCopy(parameter: AlertParameter, value: number, status: AlertSeverity) {
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

type FcmResult = "sent" | "invalid_token" | "retry";

// FCM v1: UNREGISTERED / token tidak valid = permanen (token basi, app di-uninstall).
// Token seperti ini tidak boleh membuat alert dicoba ulang terus-menerus.
async function sendFcm(env: Env, token: string, message: JsonMap): Promise<FcmResult> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await googleAccessToken(env)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: { ...message, token } }),
    },
  );
  if (response.ok) return "sent";
  const text = await response.text();
  const permanent =
    response.status === 404 ||
    /UNREGISTERED|registration-token-not-registered|SENDER_ID_MISMATCH/i.test(text) ||
    (response.status === 400 && /token/i.test(text));
  console.error("FCM send failed", { status: response.status, permanent, error: text.slice(0, 300) });
  if (response.status === 401) cachedServiceToken = null;
  return permanent ? "invalid_token" : "retry";
}

async function deleteDocument(env: Env, path: string) {
  const response = await fetch(firestoreUrl(env, path), {
    method: "DELETE",
    headers: { authorization: `Bearer ${await googleAccessToken(env)}` },
  });
  if (!response.ok && response.status !== 404) {
    console.warn("Could not delete stale push token", response.status);
  }
}

// ── PETA (OpenStreetMap) ─────────────────────────────────────────────────────
const MAP_USER_AGENT = "AirSenseAlertApi/1.0 (+https://github.com/; wearable emergency alerts)";

function parseCoordinate(url: URL) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (
    !Number.isFinite(lat) || !Number.isFinite(lon) ||
    lat < -85 || lat > 85 || lon < -180 || lon > 180
  ) {
    throw new ApiError("Koordinat tidak valid.", 400);
  }
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
}

async function cachedImage(cacheKey: string, load: () => Promise<Response>) {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const upstream = await load();
  if (!upstream.ok) {
    throw new ApiError(`Penyedia peta gagal (${upstream.status}).`, 502);
  }
  const response = new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/png",
      "cache-control": "public, max-age=604800",
      "access-control-allow-origin": "*",
    },
  });
  await cache.put(cacheKey, response.clone());
  return response;
}

// Gambar peta + pin untuk notifikasi (butuh GEOAPIFY_API_KEY, gratis 3000 gambar/hari)
async function staticMap(url: URL, env: Env) {
  if (!env.GEOAPIFY_API_KEY) throw new ApiError("Peta statis belum dikonfigurasi.", 404);
  const { lat, lon } = parseCoordinate(url);
  const cacheKey = `${url.origin}/map?lat=${lat}&lon=${lon}`;
  return cachedImage(cacheKey, () => {
    const target = new URL("https://maps.geoapify.com/v1/staticmap");
    target.searchParams.set("style", "osm-bright");
    target.searchParams.set("width", "800");
    target.searchParams.set("height", "400");
    target.searchParams.set("center", `lonlat:${lon},${lat}`);
    target.searchParams.set("zoom", "15.5");
    target.searchParams.set("marker", `lonlat:${lon},${lat};color:#e11d48;size:large`);
    target.searchParams.set("apiKey", env.GEOAPIFY_API_KEY!);
    return fetch(target.toString());
  });
}

// Proxy tile OSM (dipakai layar detail di aplikasi; tanpa API key)
async function osmTile(url: URL, match: RegExpMatchArray) {
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const max = 2 ** z;
  if (z < 0 || z > 19 || x < 0 || y < 0 || x >= max || y >= max) {
    throw new ApiError("Tile tidak valid.", 400);
  }
  return cachedImage(`${url.origin}/tile/${z}/${x}/${y}.png`, () =>
    fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { "user-agent": MAP_USER_AGENT },
    }),
  );
}

async function reportEmergencyAlert(request: Request, env: Env) {
  const uid = await verifyFirebaseToken(request, env.FIREBASE_PROJECT_ID);
  const body = await readBody(request);
  const eventId = requiredString(body.eventId, "eventId", 128);
  if (!/^[A-Za-z0-9_-]+$/.test(eventId)) {
    throw new ApiError("ID alert tidak valid.", 400);
  }
  const { parameter, value, status, location, sequence, timestampMs } =
    validateAlert(body);
  const alertPath = `profile/${uid}/notifications/${eventId}`;
  let alertDocument = await getDocument(env, alertPath);
  if (!alertDocument) {
    const created = await createDocument(env, `profile/${uid}/notifications`, eventId, {
      notifId: eventId,
      timestamp: asTimestamp(Date.now()),
      recorded_at: asTimestamp(timestampMs),
      parameter,
      value,
      status,
      location,
      sequence,
      direction: "own",
      recipientType: "owner",
      targetUid: uid,
      delivery: { status: "pending", attempted: 0, sent: 0, failed: 0 },
    });
    alertDocument = await getDocument(env, alertPath);
    if (!alertDocument) {
      throw new ApiError("Alert tersimpan tetapi tidak dapat dibaca kembali.", 503);
    }
    if (!created) {
      const currentDelivery = unfields(alertDocument.fields).delivery as JsonMap | undefined;
      if (currentDelivery?.status === "sent" || currentDelivery?.status === "no_recipients") {
        return { notifId: eventId, duplicate: true };
      }
    }
  }
  const existing = unfields(alertDocument.fields);
  const delivery = (existing.delivery ?? {}) as JsonMap;
  if (delivery.status === "sent" || delivery.status === "no_recipients") {
    return { notifId: eventId, duplicate: true };
  }

  const contacts = await listCollection(env, `profile/${uid}/emergency_contacts`);
  const recipients = new Map<
    string,
    { token: string; type: "registered" | "guest"; tokenPath?: string }
  >();
  const ownerProfile = await getDocument(env, `profile/${uid}`).catch(() => null);
  const ownerData = ownerProfile ? unfields(ownerProfile.fields) : {};
  const ownerName =
    typeof ownerData.name === "string" && ownerData.name
      ? ownerData.name
      : typeof ownerData.displayName === "string" && ownerData.displayName
        ? ownerData.displayName
        : "Pengguna AirSense";
  const registeredUids = new Set<string>();
  for (const document of contacts) {
    const contact = unfields(document.fields);
    if (contact.status !== "accepted") continue;
    if (contact.type === "guest" && typeof contact.fcm_token === "string" && contact.fcm_token) {
      const token = contact.fcm_token;
      recipients.set(await sha256(token), { token, type: "guest" });
    } else if (contact.type === "registered" && typeof contact.uid === "string") {
      if (!validDocumentId(contact.uid)) {
        console.warn("Skipping registered emergency contact with invalid UID.");
        continue;
      }
      registeredUids.add(contact.uid);
      if (typeof contact.fcm_token === "string" && contact.fcm_token) {
        const token = contact.fcm_token;
        recipients.set(await sha256(token), { token, type: "registered" });
      }
    }
  }
  for (const registeredUid of registeredUids) {
    const tokenDocuments = await listCollection(
      env,
      `profile/${registeredUid}/push_tokens`,
    );
    for (const tokenDocument of tokenDocuments) {
      const tokenData = unfields(tokenDocument.fields);
      if (typeof tokenData.token !== "string" || !tokenData.token) continue;
      const token = tokenData.token;
      const tokenPath = tokenDocument.name.split("/documents/")[1];
      recipients.set(await sha256(token), { token, type: "registered", tokenPath });
    }
  }

  const sentHashes = new Set(
    Array.isArray(delivery.sentTokenHashes)
      ? delivery.sentTokenHashes.filter((hash): hash is string => typeof hash === "string")
      : [],
  );
  const invalidHashes = new Set(
    Array.isArray(delivery.invalidTokenHashes)
      ? delivery.invalidTokenHashes.filter((hash): hash is string => typeof hash === "string")
      : [],
  );
  const pending = [...recipients.entries()].filter(
    ([hash]) => !sentHashes.has(hash) && !invalidHashes.has(hash),
  );
  const copy = alertCopy(parameter, value, status);
  const origin = new URL(request.url).origin;
  const mapUrl =
    location && env.GEOAPIFY_API_KEY
      ? `${origin}/map?lat=${location.latitude.toFixed(5)}&lon=${location.longitude.toFixed(5)}`
      : null;
  const notification: JsonMap = location
    ? {
        ...copy,
        body: `${copy.body} Lokasi: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
        ...(mapUrl ? { image: mapUrl } : {}),
      }
    : copy;
  const results = await Promise.all(
    pending.map(async ([hash, recipient]) => {
      const message: JsonMap = {
        notification,
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
          ...(mapUrl ? { mapUrl } : {}),
        },
        android: {
          priority: "HIGH",
          ttl: "3600s",
          notification: {
            channel_id: "emergency-alerts",
            sound: "default",
            ...(mapUrl ? { image: mapUrl } : {}),
          },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default", "mutable-content": 1 } },
          ...(mapUrl ? { fcm_options: { image: mapUrl } } : {}),
        },
      };
      try {
        const result = await sendFcm(env, recipient.token, message);
        if (result === "sent") {
          sentHashes.add(hash);
          return { ok: true, invalid: false };
        }
        if (result === "invalid_token") {
          invalidHashes.add(hash);
          if (recipient.tokenPath) await deleteDocument(env, recipient.tokenPath);
          return { ok: false, invalid: true };
        }
        return { ok: false, invalid: false };
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        console.error("FCM send failed", { uid, eventId, tokenHash: hash, error: messageText });
        return { ok: false, invalid: false };
      }
    }),
  );
  // Riwayat notifikasi di akun kontak terdaftar (isi sama dengan push yang diterima).
  // createDocument idempoten: percobaan ulang tidak membuat dokumen dobel.
  {
    await Promise.all(
      [...registeredUids].map((contactUid) =>
        createDocument(env, `profile/${contactUid}/notifications`, eventId, {
          notifId: eventId,
          title: notification.title,
          body: notification.body,
          timestamp: asTimestamp(Date.now()),
          recorded_at: asTimestamp(timestampMs),
          parameter,
          value,
          status,
          location,
          map_url: mapUrl,
          direction: "received",
          recipientType: "registered",
          targetUid: uid,
          sender_name: ownerName,
        }).catch((error: unknown) => {
          console.error("Could not save received notification history", { contactUid, error });
        }),
      ),
    );
  }

  const failed = results.filter((result) => !result.ok && !result.invalid).length;
  const invalid = results.filter((result) => result.invalid).length;
  const sent = results.filter((result) => result.ok).length;
  await patchDocument(
    env,
    alertPath,
    {
      delivery: {
        status:
          sentHashes.size === 0 && failed === 0
            ? "no_recipients"
            : failed === 0
              ? "sent"
              : sent > 0
                ? "partial"
                : "failed",
        attempted: Number(delivery.attempted ?? 0) + results.length,
        sent: Number(delivery.sent ?? 0) + sent,
        failed: Number(delivery.failed ?? 0) + failed,
        invalid: Number(delivery.invalid ?? 0) + invalid,
        sentTokenHashes: [...sentHashes],
        invalidTokenHashes: [...invalidHashes],
        updated_at: asTimestamp(Date.now()),
      },
    },
    ["delivery"],
  );
  if (failed > 0) throw new ApiError("Beberapa push belum terkirim; alert akan dicoba ulang.", 503);
  return { notifId: eventId, duplicate: false, sent, failed: 0 };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    const headers = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok" }, 200, headers);
    }
    if (request.method === "GET") {
      try {
        if (url.pathname === "/map") return await staticMap(url, env);
        const tile = url.pathname.match(/^\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
        if (tile) return await osmTile(url, tile);
      } catch (error) {
        return errorResponse(error, origin);
      }
    }
    if (request.method !== "POST") {
      return json({ error: "Method tidak didukung." }, 405, headers);
    }
    try {
      let result: unknown;
      if (url.pathname === "/registerPushToken") {
        result = await registerPushToken(request, env);
      } else if (url.pathname === "/createInvitation") {
        result = await createInvitation(request, env);
      } else if (url.pathname === "/acceptGuestInvitation") {
        result = await acceptGuestInvitation(request, env);
      } else if (url.pathname === "/reportEmergencyAlert") {
        result = await reportEmergencyAlert(request, env);
      } else {
        throw new ApiError("Endpoint tidak ditemukan.", 404);
      }
      return json(result, 200, headers);
    } catch (error) {
      return errorResponse(error, origin);
    }
  },
};
