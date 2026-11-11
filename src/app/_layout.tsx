import SafeAreaLayout from "@/components/safe-area-layout";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { BlePairingProvider } from "@/hooks/use-ble-pairing";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { ActivityIndicator, View, useColorScheme } from "react-native";
import "../global.css";

function RootNavigator() {
  const { user, initializing } = useAuth();

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
