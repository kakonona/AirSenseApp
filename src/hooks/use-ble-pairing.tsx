import { useAuth } from "@/context/auth-context";
import {
  BLE_ACK_CHAR_UUID,
  BLE_DATA_CHAR_UUID,
  ackPayload,
  BLE_NAME_PREFIX,
  BLE_SERVICE_UUID,
  decodePacket,
  endDeviceSession,
  flushPendingReading,
  ingestReading,
  removeDeviceRegistration,
  startDeviceSession,
} from "@/lib/device-data";
import { startLocationWatch, stopLocationWatch } from "@/lib/emergency-alerts";
import {
  startBleForegroundService,
  stopBleForegroundService,
} from "@/lib/ble-foreground-service";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BleManager,
  ScanMode,
  type Device,
  type Subscription,
} from "react-native-ble-plx";
import React from "react";
import { PermissionsAndroid, Platform } from "react-native";

type AirSenseDevice = {
  id: string;
  name: string;
  rssi: number | null;
};

type BlePairingValue = {
  connected: boolean;
  connecting: boolean;
  connectToDevice: (device: AirSenseDevice) => Promise<void>;
  devices: AirSenseDevice[];
  error: string | null;
  removeDevice: () => Promise<void>;
  scanForDevices: () => Promise<void>;
  scanning: boolean;
  selectedDevice: AirSenseDevice | null;
  stopScan: () => void;
};

const STORAGE_KEY_PREFIX = "airsense-ble-device:";
const SCAN_DURATION_MS = 15_000;
// ESP hanya bangun ±30 dtk (+ maks 20 dtk menunggu app) tiap 150 dtk. Reconnect harus
// cepat dan tanpa jeda scan, kalau tidak frame siklus itu hilang (ESP tidur tanpa kirim).
const RECONNECT_SCAN_WINDOW_MS = 25_000; // Android: maks 5 start scan / 30 dtk
const RECONNECT_FIRST_DELAY_MS = 300;
const RECONNECT_RESTART_MS = 1_000; // jeda antar jendela scan
const RECONNECT_RETRY_MS = 5_000; // jeda setelah error
const BlePairingContext = React.createContext<BlePairingValue | null>(null);

let sharedManager: BleManager | null = null;

function getManager() {
  sharedManager ??= new BleManager();
  return sharedManager;
}

// Kode BleError react-native-ble-plx untuk koneksi yang putus / operasi dibatalkan
const EXPECTED_DISCONNECT_CODES = new Set([2, 201, 205, 403]);
function isExpectedDisconnect(error: unknown) {
  const code = (error as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "number" && EXPECTED_DISCONNECT_CODES.has(code);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan Bluetooth";
}

async function requestBluetoothPermissions() {
  if (Platform.OS !== "android") {
    throw new Error("Koneksi BLE AirSense saat ini hanya tersedia di Android.");
  }

  const permissions =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error("Izin Bluetooth diperlukan untuk mencari perangkat AirSense.");
  }
}

export function BlePairingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useBlePairingController();
  return (
    <BlePairingContext.Provider value={value}>
      {children}
    </BlePairingContext.Provider>
  );
}

export function useBlePairing() {
  const context = React.useContext(BlePairingContext);
  if (!context) {
    throw new Error("useBlePairing must be used inside BlePairingProvider.");
  }
  return context;
}

function useBlePairingController(): BlePairingValue {
  const { user } = useAuth();
  const [devices, setDevices] = React.useState<AirSenseDevice[]>([]);
  const [selectedDeviceState, setSelectedDeviceState] = React.useState<{
    uid: string;
    device: AirSenseDevice;
  } | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const activeRef = React.useRef(true);
  const reconnectEnabledRef = React.useRef(false);
  const cancelReconnectRef = React.useRef<(() => void) | null>(null);
  const foregroundServiceStartedRef = React.useRef(false);
  const connectedDeviceRef = React.useRef<Device | null>(null);
  const monitorRef = React.useRef<Subscription | null>(null);
  const disconnectRef = React.useRef<Subscription | null>(null);
  const scanTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = user?.uid;
  const selectedDevice =
    selectedDeviceState && selectedDeviceState.uid === uid
      ? selectedDeviceState.device
      : null;
  const setSelectedDevice = React.useCallback(
    (device: AirSenseDevice | null) => {
      setSelectedDeviceState(device && uid ? { uid, device } : null);
    },
    [uid],
  );

  const stopScan = React.useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (sharedManager) {
      void sharedManager.stopDeviceScan().catch((scanError: unknown) => {
        if (activeRef.current) setError(errorText(scanError));
      });
    }
    if (activeRef.current) setScanning(false);
  }, []);

  const scanForDevices = React.useCallback(async () => {
    setError(null);
    setDevices([]);
    cancelReconnectRef.current?.();
    stopScan();
    try {
      await requestBluetoothPermissions();
      const manager = getManager();
      const state = await manager.state();
      if (state !== "PoweredOn") {
        throw new Error("Nyalakan Bluetooth di HP lalu coba lagi.");
      }

      setScanning(true);
      await manager.startDeviceScan(
        null,
        { scanMode: ScanMode.LowLatency },
        (scanError, device) => {
          if (!activeRef.current) return;
          if (scanError) {
            stopScan();
            setError(errorText(scanError));
            return;
          }
          if (!device) return;

          const name = device.name ?? device.localName ?? "";
          const advertisesService = device.serviceUUIDs?.some(
            (serviceUuid) =>
              serviceUuid.toLowerCase() === BLE_SERVICE_UUID.toLowerCase(),
          );
          if (
            !name.toLowerCase().startsWith(BLE_NAME_PREFIX.toLowerCase()) &&
            !advertisesService
          ) {
            return;
          }

          const found: AirSenseDevice = {
            id: device.id,
            name: name || BLE_NAME_PREFIX,
            rssi: device.rssi,
          };
          setDevices((current) => {
            const previousIndex = current.findIndex(
              (item) => item.id === found.id,
            );
            if (previousIndex < 0) return [...current, found];
            return current.map((item, index) =>
              index === previousIndex ? found : item,
            );
          });
        },
      );
      scanTimerRef.current = setTimeout(stopScan, SCAN_DURATION_MS);
    } catch (scanError) {
      setScanning(false);
      setError(errorText(scanError));
      throw scanError;
    }
  }, [stopScan]);

  const releaseConnection = React.useCallback(async () => {
    monitorRef.current?.remove();
    disconnectRef.current?.remove();
    monitorRef.current = null;
    disconnectRef.current = null;
    const device = connectedDeviceRef.current;
    connectedDeviceRef.current = null;
    setConnected(false);

    if (device) {
      const manager = getManager();
      if (await manager.isDeviceConnected(device.id)) {
        await manager.cancelDeviceConnection(device.id);
      }
      await stopBleForegroundService();
      foregroundServiceStartedRef.current = false;
      stopLocationWatch();
      if (uid) {
        await flushPendingReading(uid).catch((flushError: unknown) => {
          console.error("Gagal menyimpan riwayat wearable:", flushError);
        });
        // tidak di-await: saat offline penulisan RTDB menunggu tanpa batas
        void endDeviceSession(uid).catch((sessionError: unknown) => {
          console.warn("[BLE] Gagal menandai perangkat offline:", sessionError);
        });
      }
    }
  }, [uid]);

  const connectToDevice = React.useCallback(
    async (candidate: AirSenseDevice) => {
      if (!uid) throw new Error("Masuk ke akun terlebih dahulu.");
      setError(null);
      setConnecting(true);
      reconnectEnabledRef.current = true;
      cancelReconnectRef.current?.();
      stopScan();

      try {
        await requestBluetoothPermissions();
        if (connectedDeviceRef.current?.id === candidate.id) return;
        await releaseConnection();

        const manager = getManager();
        const device = await manager.connectToDevice(candidate.id, {
          timeout: 15_000,
        });
        connectedDeviceRef.current = device;
        const discovered =
          await manager.discoverAllServicesAndCharacteristicsForDevice(device.id);
        const services = await discovered.services();
        const service = services.find(
          (item) => item.uuid.toLowerCase() === BLE_SERVICE_UUID.toLowerCase(),
        );
        if (!service) {
          throw new Error(
            "Service BLE AirSense tidak ditemukan. Periksa UUID firmware ESP32.",
          );
        }

        const characteristics =
          await discovered.characteristicsForService(service.uuid);
        const dataCharacteristic = characteristics.find(
          (item) =>
            item.uuid.toLowerCase() === BLE_DATA_CHAR_UUID.toLowerCase(),
        );
        if (!dataCharacteristic?.isNotifiable && !dataCharacteristic?.isIndicatable) {
          throw new Error(
            "Characteristic data BLE tidak mendukung notifikasi. Periksa firmware ESP32.",
          );
        }
        const ackCharacteristic = characteristics.find(
          (item) => item.uuid.toLowerCase() === BLE_ACK_CHAR_UUID.toLowerCase(),
        );
        if (!ackCharacteristic) {
          throw new Error(
            "Firmware wearable belum mendukung ACK (protokol v3). Flash ulang firmware AIRSENSE_V3.",
          );
        }
        // Konfirmasi ke ESP bahwa record seq sudah aman di HP -> ESP berhenti mengirim ulang
        const sendAck = async (seq: number) => {
          const payload = ackPayload(seq);
          try {
            if (ackCharacteristic.isWritableWithoutResponse) {
              await manager.writeCharacteristicWithoutResponseForDevice(
                device.id,
                service.uuid,
                ackCharacteristic.uuid,
                payload,
              );
            } else {
              await manager.writeCharacteristicWithResponseForDevice(
                device.id,
                service.uuid,
                ackCharacteristic.uuid,
                payload,
              );
            }
          } catch (ackError) {
            // ESP akan mengirim ulang record ini; app menyaringnya sebagai duplikat
            console.warn(`[BLE] ACK seq ${seq} gagal dikirim:`, errorText(ackError));
          }
        };

        const connectedInfo: AirSenseDevice = {
          ...candidate,
          name: device.name ?? candidate.name,
          rssi: device.rssi,
        };
        connectedDeviceRef.current = device;
        setSelectedDevice(connectedInfo);
        await AsyncStorage.setItem(
          `${STORAGE_KEY_PREFIX}${uid}`,
          JSON.stringify(connectedInfo),
        );

        monitorRef.current = manager.monitorCharacteristicForDevice(
          device.id,
          service.uuid,
          dataCharacteristic.uuid,
          (monitorError, characteristic) => {
            if (!activeRef.current) return;
            if (monitorError) {
              // Monitor selalu error saat ESP masuk deep sleep (koneksi putus) -> bukan masalah
              if (!connectedDeviceRef.current || isExpectedDisconnect(monitorError)) {
                console.log("[BLE] monitor berhenti (perangkat tidur/terputus)");
                return;
              }
              setError(errorText(monitorError));
              return;
            }
            if (!characteristic?.value) return;

            const reading = decodePacket(characteristic.value);
            if (!reading) return;
            void ingestReading(uid, reading, sendAck).catch((ingestError: unknown) => {
              // Gagal kirim ke Firebase (mis. jaringan) tidak boleh dianggap error BLE
              console.warn("[BLE] Gagal mengirim data wearable ke Firebase:", ingestError);
            });
          },
        );
        disconnectRef.current = manager.onDeviceDisconnected(
          device.id,
          (disconnectError) => {
            if (!activeRef.current) return;
            monitorRef.current?.remove();
            monitorRef.current = null;
            disconnectRef.current = null;
            connectedDeviceRef.current = null;
            setConnected(false);
            // Putus karena ESP deep sleep adalah perilaku normal siklus 30/120 dtk:
            // jangan tampilkan error, cukup catat lalu auto-reconnect.
            if (disconnectError) {
              console.log("[BLE] terputus:", errorText(disconnectError));
            }
            // ESP masuk deep sleep -> simpan jendela ukur yang belum tersimpan
            void flushPendingReading(uid).catch((flushError: unknown) => {
              console.warn("[BLE] Gagal menyimpan jendela ukur terakhir:", flushError);
            });
            void endDeviceSession(uid).catch((sessionError: unknown) => {
              console.warn("[BLE] Gagal menandai perangkat offline:", sessionError);
            });
          },
        );

        // tidak di-await: saat HP offline penulisan RTDB menunggu tanpa batas,
        // padahal data wearable tetap harus diterima & disimpan lokal.
        void startDeviceSession(uid).catch((sessionError: unknown) => {
          console.warn("[BLE] Gagal menandai perangkat online:", sessionError);
        });
        void startLocationWatch();
        if (!foregroundServiceStartedRef.current) {
          try {
            await startBleForegroundService();
            foregroundServiceStartedRef.current = true;
          } catch (serviceError) {
            setError(errorText(serviceError));
          }
        }
        setConnected(true);
      } catch (connectionError) {
        setError(errorText(connectionError));
        if (connectedDeviceRef.current?.id === candidate.id) {
          await releaseConnection().catch((releaseError: unknown) => {
            setError(errorText(releaseError));
          });
        }
        throw connectionError;
      } finally {
        setConnecting(false);
      }
    },
    [releaseConnection, setSelectedDevice, stopScan, uid],
  );

  React.useEffect(() => {
    if (
      !uid ||
      !selectedDevice ||
      connected ||
      connecting ||
      scanning ||
      !reconnectEnabledRef.current
    ) {
      return;
    }

    let cancelled = false;
    let autoScanInProgress = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    const manager = getManager();

    let found = false;
    const scheduleRetry = (delay = RECONNECT_RETRY_MS) => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void beginScan();
      }, delay);
    };

    const beginScan = async () => {
      if (cancelled) return;
      try {
        const state = await manager.state();
        if (state !== "PoweredOn") {
          setError("Nyalakan Bluetooth untuk menghubungkan ulang wearable.");
          scheduleRetry();
          return;
        }

        await manager.startDeviceScan(
          null,
          { scanMode: ScanMode.LowLatency },
          (scanError, device) => {
            if (cancelled) return;
            if (scanError) {
              autoScanInProgress = false;
              if (scanTimer) {
                clearTimeout(scanTimer);
                scanTimer = null;
              }
              setError(errorText(scanError));
              void manager.stopDeviceScan().catch((stopError: unknown) => {
                if (activeRef.current) setError(errorText(stopError));
              });
              scheduleRetry();
              return;
            }
            if (!device || found) return;
            const name = device.name ?? device.localName ?? "";
            if (
              device.id !== selectedDevice.id &&
              !name.toLowerCase().startsWith(BLE_NAME_PREFIX.toLowerCase())
            ) {
              return;
            }

            found = true; // callback scan bisa terpanggil berkali-kali sebelum scan berhenti
            if (scanTimer) {
              clearTimeout(scanTimer);
              scanTimer = null;
            }
            autoScanInProgress = false;
            void manager
              .stopDeviceScan()
              .then(() =>
                connectToDevice({
                  id: device.id,
                  name: name || selectedDevice.name,
                  rssi: device.rssi,
                }),
              )
              .catch((connectError: unknown) => {
                if (activeRef.current) setError(errorText(connectError));
              });
          },
        );
        autoScanInProgress = true;
        scanTimer = setTimeout(() => {
          scanTimer = null;
          autoScanInProgress = false;
          void manager
            .stopDeviceScan()
            .then(() => scheduleRetry(RECONNECT_RESTART_MS))
            .catch((stopError: unknown) => {
              if (activeRef.current) setError(errorText(stopError));
              scheduleRetry();
            });
        }, RECONNECT_SCAN_WINDOW_MS);
      } catch (scanError) {
        setError(errorText(scanError));
        scheduleRetry();
      }
    };

    const cancelReconnect = () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (scanTimer) clearTimeout(scanTimer);
      if (autoScanInProgress) {
        autoScanInProgress = false;
        void manager.stopDeviceScan().catch((stopError: unknown) => {
          if (activeRef.current) setError(errorText(stopError));
        });
      }
    };
    cancelReconnectRef.current = cancelReconnect;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void beginScan();
    }, RECONNECT_FIRST_DELAY_MS);

    return () => {
      cancelReconnect();
      if (cancelReconnectRef.current === cancelReconnect) {
        cancelReconnectRef.current = null;
      }
    };
  }, [connectToDevice, connected, connecting, scanning, selectedDevice, uid]);

  const removeDevice = React.useCallback(async () => {
    setError(null);
    reconnectEnabledRef.current = false;
    cancelReconnectRef.current?.();
    try {
      await releaseConnection();
      await stopBleForegroundService();
      foregroundServiceStartedRef.current = false;
      if (uid) {
        await AsyncStorage.removeItem(`${STORAGE_KEY_PREFIX}${uid}`);
        await removeDeviceRegistration(uid);
      }
      setSelectedDevice(null);
    } catch (removeError) {
      setError(errorText(removeError));
      throw removeError;
    }
  }, [releaseConnection, setSelectedDevice, uid]);

  React.useEffect(() => {
    activeRef.current = true;
    if (!uid) {
      return () => {
        activeRef.current = false;
      };
    }

    let cancelled = false;
    const restoreSavedDevice = async () => {
      const saved = await AsyncStorage.getItem(`${STORAGE_KEY_PREFIX}${uid}`);
      if (!saved || cancelled) return;
      const parsed = JSON.parse(saved) as AirSenseDevice;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        cancelled
      ) {
        throw new Error("Data perangkat BLE tersimpan tidak valid.");
      }
      reconnectEnabledRef.current = true;
      setSelectedDevice(parsed);
      try {
        await connectToDevice(parsed);
      } catch {
        if (!foregroundServiceStartedRef.current) {
          try {
            await startBleForegroundService();
            foregroundServiceStartedRef.current = true;
          } catch (serviceError) {
            setError(errorText(serviceError));
          }
        }
      }
    };

    void restoreSavedDevice().catch((restoreError: unknown) => {
      setError(errorText(restoreError));
    });

    return () => {
      cancelled = true;
      activeRef.current = false;
      reconnectEnabledRef.current = false;
      cancelReconnectRef.current?.();
      stopScan();
      void releaseConnection().catch((releaseError: unknown) => {
        console.warn("Failed to close BLE session:", releaseError);
      });
      void stopBleForegroundService().catch((serviceError: unknown) => {
        console.warn("Failed to stop BLE foreground service:", serviceError);
      });
      foregroundServiceStartedRef.current = false;
    };
  }, [connectToDevice, releaseConnection, setSelectedDevice, stopScan, uid]);

  return {
    connected,
    connecting,
    connectToDevice,
    devices,
    error,
    removeDevice,
    scanForDevices,
    scanning,
    selectedDevice,
    stopScan,
  };
}
