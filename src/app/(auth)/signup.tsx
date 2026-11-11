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
import { useRouter } from "expo-router";
import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SignupScreen() {
  const router = useRouter();
  const { signUp, signInWithGoogle } = useAuth();
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<Message | null>(null);

  const handleSignup = async () => {
    if (!username.trim() || !email.trim() || !password || !confirm) {
      setMessage({ type: "error", text: "Semua kolom wajib diisi" });
      return;
    }
    if (!email.includes("@")) {
      setMessage({ type: "error", text: "Format email tidak valid" });
      return;
    }
    if (password.length < 6) {
      setMessage({ type: "error", text: "Kata sandi minimal 6 karakter" });
      return;
    }
    if (password !== confirm) {
      setMessage({ type: "error", text: "Konfirmasi kata sandi tidak sama" });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await signUp(username, email, password);
      // Berhasil → guard di root layout otomatis memindahkan ke halaman utama
    } catch (e) {
      setMessage({ type: "error", text: authErrorMessage(e) });
    } finally {
      setLoading(false);
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
              title="Buat Akun"
              subtitle={
                <>
                  daftarkan diri anda untuk mulai menggunakan{" "}
                  <Text style={{ color: COLORS.greenLight, fontWeight: "700" }}>
                    AirSense
                  </Text>
                </>
              }
            />
            <View style={{ marginVertical: 8 }}>
              <Landscape />
            </View>

            <AuthInput
              icon="person"
              placeholder="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <AuthInput
              icon="person"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <AuthInput
              icon="lock"
              placeholder="Kata Sandi"
              value={password}
              onChangeText={setPassword}
              secure
              autoCapitalize="none"
            />
            <AuthInput
              icon="lock"
              placeholder="Konfirmasi kata sandi"
              value={confirm}
              onChangeText={setConfirm}
              secure
              autoCapitalize="none"
            />

            <FormMessage message={message} />
            <PrimaryButton
              label="Daftar"
              onPress={handleSignup}
              loading={loading}
            />

            <OrDivider />
            <GoogleButton onPress={handleGoogle} />

            <Text
              style={{
                textAlign: "center",
                fontSize: 12,
                color: "#374151",
                marginTop: 28,
              }}
            >
              sudah punya akun?{" "}
              <LinkText onPress={() => router.replace("/login")}>Masuk</LinkText>
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AuthScreenBackground>
  );
}
