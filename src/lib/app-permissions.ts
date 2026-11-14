import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  AndroidImportance,
  setNotificationChannelAsync,
  setNotificationHandler,
  getPermissionsAsync,
  requestPermissionsAsync,
} from "expo-notifications";
import { Alert, Linking, Platform } from "react-native";

const PERMISSIONS_REQUESTED_KEY = "airsense:alert-permissions-requested:v1";
const EMERGENCY_CHANNEL_ID = "emergency-alerts";

setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestInitialAlertPermissions() {
  if (Platform.OS === "web") return;

  if (Platform.OS === "android") {
    await setNotificationChannelAsync(EMERGENCY_CHANNEL_ID, {
      name: "Peringatan darurat",
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
    });
  }

  if ((await AsyncStorage.getItem(PERMISSIONS_REQUESTED_KEY)) === "true") {
    return;
  }

  const notificationPermission = await getPermissionsAsync();
  if (notificationPermission.status !== "granted") {
    await requestPermissionsAsync();
  }

  const foregroundLocation = await Location.getForegroundPermissionsAsync();
  const grantedForeground =
    foregroundLocation.status === "granted" ||
    (await Location.requestForegroundPermissionsAsync()).status === "granted";

  let grantedBackground = true;
  if (grantedForeground && Platform.OS === "android") {
    const backgroundLocation = await Location.getBackgroundPermissionsAsync();
    grantedBackground =
      backgroundLocation.status === "granted" ||
      (await Location.requestBackgroundPermissionsAsync()).status === "granted";
  }

  await AsyncStorage.setItem(PERMISSIONS_REQUESTED_KEY, "true");

  const updatedNotificationPermission = await getPermissionsAsync();
  if (
    updatedNotificationPermission.status !== "granted" ||
    !grantedForeground ||
    !grantedBackground
  ) {
    Alert.alert(
      "Izin peringatan belum lengkap",
      "AirSense memerlukan izin notifikasi dan lokasi agar dapat menampilkan alert serta menyertakan koordinat saat terjadi kondisi berbahaya.",
      [
        { text: "Nanti", style: "cancel" },
        { text: "Buka pengaturan", onPress: () => void Linking.openSettings() },
      ],
    );
  }
}

export { EMERGENCY_CHANNEL_ID };
