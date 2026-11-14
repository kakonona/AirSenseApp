import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

const env: Env = {
  FIREBASE_PROJECT_ID: "airsensecp1",
  GOOGLE_SERVICE_ACCOUNT: "",
};

describe("AirSense alert Worker", () => {
  it("reports health without credentials", async () => {
    const response = await worker.fetch(
      new Request("https://airsense-alert-api.example/health"),
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("allows CORS preflight for the app API", async () => {
    const response = await worker.fetch(
      new Request("https://airsense-alert-api.example/reportEmergencyAlert", {
        method: "OPTIONS",
        headers: { origin: "https://airsense.example" },
      }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://airsense.example",
    );
  });

  it("rejects unknown API endpoints", async () => {
    const response = await worker.fetch(
      new Request("https://airsense-alert-api.example/not-an-endpoint", {
        method: "POST",
      }),
      env,
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Endpoint tidak ditemukan.",
    });
  });

  it("requires a Firebase user token to register a push device", async () => {
    const response = await worker.fetch(
      new Request("https://airsense-alert-api.example/registerPushToken", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-a-real-token" }),
      }),
      env,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Sesi Firebase diperlukan.",
    });
  });
});
