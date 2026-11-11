import { useAuth } from "@/context/auth-context";
import {
  BLE_DATA_CHAR_UUID,
  BLE_NAME_PREFIX,
  BLE_SERVICE_UUID,
  decodePacket,
  endDeviceSession,
  ingestReading,
  removeDeviceRegistration,
  startDeviceSession,
} from "@/lib/device-data";
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
const BlePairingContext = React.createContext<BlePairingValue | null>(null);

let sharedManager: BleManager | null = null;

function getManager() {
  sharedManager ??= new BleManager();
  return sharedManager;
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
  const [selectedDevice, setSelectedDevice] =
    React.useState<AirSenseDevice | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const activeRef = React.useRef(true);
  const connectedDeviceRef = React.useRef<Device | null>(null);
  const monitorRef = React.useRef<Subscription | null>(null);
  const disconnectRef = React.useRef<Subscription | null>(null);
  const scanTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = user?.uid;

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
      if (uid) await endDeviceSession(uid);
    }
  }, [uid]);

  const connectToDevice = React.useCallback(
    async (candidate: AirSenseDevice) => {
      if (!uid) throw new Error("Masuk ke akun terlebih dahulu.");
      setError(null);
      setConnecting(true);
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
              setError(errorText(monitorError));
              return;
            }
            if (!characteristic?.value) return;

            const reading = decodePacket(characteristic.value);
            if (!reading) return;
            void ingestReading(uid, reading).catch((ingestError: unknown) => {
              setError(errorText(ingestError));
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
            if (disconnectError) setError(errorText(disconnectError));
            void endDeviceSession(uid).catch((sessionError: unknown) => {
              setError(errorText(sessionError));
            });
          },
        );

        await startDeviceSession(uid);
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
    [releaseConnection, stopScan, uid],
  );

  const removeDevice = React.useCallback(async () => {
    setError(null);
    try {
      await releaseConnection();
      if (uid) {
        await AsyncStorage.removeItem(`${STORAGE_KEY_PREFIX}${uid}`);
        await removeDeviceRegistration(uid);
      }
      setSelectedDevice(null);
    } catch (removeError) {
      setError(errorText(removeError));
      throw removeError;
    }
  }, [releaseConnection, uid]);

  React.useEffect(() => {
    activeRef.current = true;
    if (!uid) {
      setSelectedDevice(null);
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
      setSelectedDevice(parsed);
      try {
        await connectToDevice(parsed);
      } catch {
        // The connection error is shown in the device panel; the saved device can be retried.
      }
    };

    void restoreSavedDevice().catch((restoreError: unknown) => {
      setError(errorText(restoreError));
    });

    return () => {
      cancelled = true;
      activeRef.current = false;
      stopScan();
      void releaseConnection().catch((releaseError: unknown) => {
        console.warn("Failed to close BLE session:", releaseError);
      });
    };
  }, [connectToDevice, releaseConnection, stopScan, uid]);

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
