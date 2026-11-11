import {
  AuthScreenBackground,
  AuthHeader,
  AuthInput,
  COLORS,
  FormMessage,
  GoogleButton,
  Landscape,
  LinkText,
  OrDivider,
  PrimaryButton,
  type Message,
} from "@/components/auth-ui";
import { authErrorMessage, useAuth } from "@/context/auth-context";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const REMEMBER_KEY = "remembered_identifier";

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle, resetPassword } = useAuth();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [remember, setRemember] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<Message | null>(null);

  // "Ingat Saya" = mengingat email/username yang terakhir dipakai
  React.useEffect(() => {
    AsyncStorage.getItem(REMEMBER_KEY).then((saved) => {
      if (saved) {
        setIdentifier(saved);
        setRemember(true);
      }
    });
  }, []);

  const handleLogin = async () => {
    if (!identifier.trim() || !password) {
      setMessage({ type: "error", text: "Isi email/username dan password" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await signIn(identifier, password);
      if (remember) await AsyncStorage.setItem(REMEMBER_KEY, identifier.trim());
      else await AsyncStorage.removeItem(REMEMBER_KEY);
    } catch (e) {
      setMessage({ type: "error", text: authErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    if (!identifier.trim()) {
      setMessage({
        type: "error",
        text: "Isi email atau username dulu di kolom atas",
      });
      return;
    }
    try {
      await resetPassword(identifier);
      setMessage({
        type: "info",
        text: "Link reset password sudah dikirim ke email kamu",
      });
    } catch (e) {
      setMessage({ type: "error", text: authErrorMessage(e) });
    }
  };

  const handleGoogle = async () => {
    setMessage(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setMessage({ type: "error", text: authErrorMessage(e) });
    }
  };

  return (
    <AuthScreenBackground>
      <SafeAreaView style={{ flex: 1, backgroundColor: "transparent" }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <AuthHeader
              title="Masuk"
              subtitle="masuk ke akun anda untuk melanjutkan"
            />
            <View style={{ marginVertical: 8 }}>
              <Landscape />
            </View>

            <AuthInput
              icon="person"
              placeholder="Email/Username"
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <AuthInput
              icon="lock"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
            />

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <Pressable
                onPress={() => setRemember((r) => !r)}
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <MaterialIcons
                  name={remember ? "check-box" : "check-box-outline-blank"}
                  size={18}
                  color={remember ? COLORS.green : COLORS.muted}
                />
                <Text
                  style={{ marginLeft: 4, fontSize: 12, color: COLORS.muted }}
                >
                  Ingat Saya
                </Text>
              </Pressable>
              <Text style={{ fontSize: 12 }}>
                <LinkText onPress={handleForgot}>Lupa Password?</LinkText>
              </Text>
            </View>

            <FormMessage message={message} />
            <PrimaryButton
              label="Masuk"
              onPress={handleLogin}
              loading={loading}
            />

            <OrDivider />
            <GoogleButton onPress={handleGoogle} />

            <Text
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "#374151",
                marginTop: 32,
              }}
            >
              belum punya akun?{" "}
              <LinkText onPress={() => router.replace("/signup")}>
                Daftar
              </LinkText>
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AuthScreenBackground>
  );
}
