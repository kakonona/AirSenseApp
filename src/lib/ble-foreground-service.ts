import { NativeModules, Platform } from "react-native";

type AirSenseBleServiceModule = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

const service = NativeModules.AirSenseBleService as
  | AirSenseBleServiceModule
  | undefined;

export async function startBleForegroundService() {
  if (Platform.OS !== "android") return;
  if (!service) {
    throw new Error(
      "Layanan BLE background belum tersedia. Buat ulang APK setelah konfigurasi native diperbarui.",
    );
  }
  await service.start();
}

export async function stopBleForegroundService() {
  if (Platform.OS !== "android" || !service) return;
  await service.stop();
}
