import { acceptGuestInvitation } from "@/lib/emergency-alerts";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DARK = "#1f3a2e";

export default function GuestInviteScreen() {
  const { inviteId: rawInviteId } = useLocalSearchParams<{
    inviteId: string | string[];
  }>();
  const inviteId = Array.isArray(rawInviteId) ? rawInviteId[0] : rawInviteId;
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [accepted, setAccepted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const accept = async () => {
    if (!inviteId) {
      setError("Tautan undangan tidak valid.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptGuestInvitation(inviteId, name.trim());
      setAccepted(true);
    } catch (acceptError) {
      const message =
        acceptError instanceof Error
          ? acceptError.message
          : "Undangan tidak dapat diterima.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F7F8F3" }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 28,
            padding: 24,
            shadowColor: "#000",
            shadowOpacity: 0.08,
            shadowRadius: 16,
            elevation: 3,
          }}
        >
          <Text style={{ color: DARK, fontSize: 24, fontWeight: "700" }}>
            Undangan kontak darurat
          </Text>
          <Text style={{ color: "#5B665E", fontSize: 15, lineHeight: 23, marginTop: 12 }}>
            {accepted
              ? "Undangan diterima. Perangkat ini akan menerima notifikasi darurat dan snapshot lokasi."
              : "Terima undangan untuk mendapatkan notifikasi darurat AirSense. Aplikasi harus terpasang dan izin notifikasi perlu diaktifkan."}
          </Text>

          {!accepted && (
            <>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nama Anda (opsional)"
                placeholderTextColor="#8A938B"
                maxLength={80}
                style={{
                  marginTop: 22,
                  borderWidth: 1,
                  borderColor: "#DDE4DD",
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  color: "#1F2937",
                }}
              />
              {error ? (
                <Text accessibilityRole="alert" style={{ color: "#B42318", marginTop: 12 }}>
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void accept()}
                style={{
                  minHeight: 52,
                  marginTop: 18,
                  borderRadius: 16,
                  backgroundColor: DARK,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                    Terima undangan
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
