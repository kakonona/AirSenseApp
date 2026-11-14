import SafeAreaLayout from "@/components/safe-area-layout";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { BlePairingProvider } from "@/hooks/use-ble-pairing";
import { requestInitialAlertPermissions } from "@/lib/app-permissions";
import { startOfflineSync } from "@/lib/offline-queue";
import {
  registerAuthenticatedPushToken,
  watchPushTokenChanges,
} from "@/lib/emergency-alerts";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import React from "react";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
} from "expo-router";
import { ActivityIndicator, Alert, View, useColorScheme } from "react-native";
import "../global.css";

function RootNavigator() {
  const { user, initializing } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    const openAlert = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      if (!data || data.url !== "/emergency-alert") return;
      Notifications.clearLastNotificationResponse();
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        if (
          key !== "url" &&
          (typeof value === "string" || typeof value === "number")
        ) {
          params[key] = String(value);
        }
      }
      router.push({ pathname: "/emergency-alert", params });
    };

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) openAlert(lastResponse);
    const subscription =
      Notifications.addNotificationResponseReceivedListener(openAlert);
    return () => subscription.remove();
  }, [router]);

  // Sinkron data yang tersimpan di HP saat offline (tiap 1 jam / saat internet kembali)
  React.useEffect(() => {
    if (initializing || !user) return;
    return startOfflineSync();
  }, [initializing, user]);

  React.useEffect(() => {
    if (initializing || !user || user.isAnonymous) return;
    void registerAuthenticatedPushToken().catch((error: unknown) => {
      Alert.alert(
        "Notifikasi kontak belum aktif",
        error instanceof Error
          ? error.message
          : "Pendaftaran FCM gagal. Lihat diagnostik aplikasi untuk detail tanpa token.",
      );
    });
    return watchPushTokenChanges();
  }, [initializing, user]);

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FAF9F6",
        }}
      >
        <ActivityIndicator color="#6B9E7E" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="invite/[inviteId]" />
      <Stack.Screen name="emergency-alert" />
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="notifications" />
      </Stack.Protected>
      <Stack.Protected guard={!!user} redirectTo="/welcome">
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!user} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Adelia: require("../../assets/adelia.ttf"),
    PlusJakartaSans_400Regular,
    PlusJakartaSans_700Bold,
  });
  const colorScheme = useColorScheme();

  React.useEffect(() => {
    if (!fontsLoaded) return;
    void requestInitialAlertPermissions().catch((error: unknown) => {
      console.error("Could not request AirSense alert permissions:", error);
      Alert.alert(
        "Izin aplikasi gagal diminta",
        "Buka pengaturan perangkat untuk mengaktifkan notifikasi dan lokasi bagi AirSense.",
      );
    });
  }, [fontsLoaded]);

  if (fontError) {
    throw fontError;
  }

  if (!fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FAF9F6",
        }}
      >
        <ActivityIndicator color="#6B9E7E" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <BlePairingProvider>
          <SafeAreaLayout>
            <RootNavigator />
          </SafeAreaLayout>
        </BlePairingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
