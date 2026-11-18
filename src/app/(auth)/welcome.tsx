import { COLORS, PrimaryButton } from "@/components/auth-ui";
import { leaveGuestInvitation } from "@/lib/emergency-alerts";
import { useGuestState, type GuestAlert, type GuestOwner } from "@/lib/guest-mode";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Bell,
  ChevronRight,
  LogIn,
  Settings,
  ShieldCheck,
  UserPlus,
  UserX,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const DARK = "#1f3a2e";

function formatTime(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} ${time}`;
}

function useNotificationsAllowed() {
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      Notifications.getPermissionsAsync()
        .then((p) => active && setAllowed(p.status === "granted"))
        .catch(() => active && setAllowed(null));
      return () => {
        active = false;
      };
    }, []),
  );
  return allowed;
}

// ── Kartu mode tamu ──────────────────────────────────────────────────────────
function GuestCard({
  owners,
  alerts,
  notificationsAllowed,
  onOpenAlert,
}: {
  owners: GuestOwner[];
  alerts: GuestAlert[];
  notificationsAllowed: boolean | null;
  onOpenAlert: (alert: GuestAlert) => void;
}) {
  const names = owners.map((o) => o.ownerName).join(", ");
  const since = Math.min(...owners.map((o) => o.acceptedAt));
  return (
    <View
      style={{
        backgroundColor: "#fff",
        borderRadius: 18,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#E3EBE3",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <ShieldCheck size={18} color={COLORS.green} />
        <Text style={{ marginLeft: 6, fontWeight: "700", color: DARK }}>
          Kontak darurat (tamu)
        </Text>
      </View>
      <Text style={{ marginTop: 6, color: "#374151" }}>
        Memantau: <Text style={{ fontWeight: "700" }}>{names}</Text>
      </Text>
      <Text style={{ marginTop: 2, color: "#6b7280", fontSize: 12 }}>
        Sejak {new Date(since).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: notificationsAllowed === false ? "#DC2626" : "#16A34A",
            marginRight: 6,
          }}
        />
        <Text style={{ fontSize: 12, color: "#374151" }}>
          {notificationsAllowed === false
            ? "Izin notifikasi mati — buka pengaturan ⚙️"
            : "Notifikasi aktif, tetap masuk walau aplikasi ditutup"}
        </Text>
      </View>

      <Text style={{ marginTop: 12, fontWeight: "700", color: DARK, fontSize: 13 }}>
        Peringatan terakhir
      </Text>
      {alerts.length === 0 ? (
        <Text style={{ marginTop: 4, color: "#6b7280", fontSize: 12 }}>
          Belum ada peringatan.
        </Text>
      ) : (
        alerts.slice(0, 5).map((a) => {
          const danger = a.status === "danger";
          return (
            <Pressable
              key={a.id}
              onPress={() => onOpenAlert(a)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: "#F0F2EF",
                marginTop: 4,
              }}
            >
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: danger ? "#FEE2E2" : "#FEF3C7",
                  marginRight: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: "700",
                    color: danger ? "#B42318" : "#946200",
                  }}
                >
                  {danger ? "KRITIS" : "WASPADA"}
                </Text>
              </View>
              <Text style={{ flex: 1, fontSize: 13, color: "#1F2937" }} numberOfLines={1}>
                {a.parameter} {a.value}
                {owners.length > 1 ? ` · ${a.ownerName}` : ""}
              </Text>
              <Text style={{ fontSize: 12, color: "#6b7280", marginHorizontal: 4 }}>
                {formatTime(a.timestampMs)}
              </Text>
              <ChevronRight size={16} color="#9CA3AF" />
            </Pressable>
          );
        })
      )}
    </View>
  );
}

// ── Lembar pengaturan (tombol ⚙️) ─────────────────────────────────────────────
function SettingsRow({
  icon,
  label,
  hint,
  danger,
  busy,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}
    >
      {icon}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: danger ? "#B42318" : "#1F2937" }}>
          {label}
        </Text>
        {hint ? <Text style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{hint}</Text> : null}
      </View>
      {busy ? <ActivityIndicator color={COLORS.green} /> : <ChevronRight size={18} color="#9CA3AF" />}
    </Pressable>
  );
}

function SettingsSheet({
  visible,
  onClose,
  owners,
  notificationsAllowed,
}: {
  visible: boolean;
  onClose: () => void;
  owners: GuestOwner[];
  notificationsAllowed: boolean | null;
}) {
  const router = useRouter();
  const [leaving, setLeaving] = React.useState<string | null>(null);

  const go = (path: "/signup" | "/login") => {
    onClose();
    router.push(path);
  };

  const leave = (owner: GuestOwner) => {
    Alert.alert(
      "Berhenti jadi kontak darurat?",
      `HP ini tidak akan lagi menerima peringatan dari ${owner.ownerName}. Untuk memantau lagi, ${owner.ownerName} perlu mengirim link undangan baru.`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Berhenti",
          style: "destructive",
          onPress: () => {
            setLeaving(owner.inviteId);
            leaveGuestInvitation(owner.inviteId)
              .catch((error: unknown) =>
                Alert.alert(
                  "Gagal",
                  error instanceof Error ? error.message : "Coba lagi saat ada internet.",
                ),
              )
              .finally(() => setLeaving(null));
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: "#fff",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 10,
          }}
        >
          <SafeAreaView edges={["bottom"]} style={{ paddingBottom: 8 }}>
            <View
              style={{
                alignSelf: "center",
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: "#D1D5DB",
                marginBottom: 12,
              }}
            />
            <Text style={{ fontSize: 18, fontWeight: "700", color: DARK, marginBottom: 4 }}>
              Pengaturan
            </Text>

            <SettingsRow
              icon={<UserPlus size={20} color={DARK} />}
              label="Buat akun"
              hint="Pantau kondisi sendiri dengan wearable AirSense"
              onPress={() => go("/signup")}
            />
            <SettingsRow
              icon={<LogIn size={20} color={DARK} />}
              label="Masuk"
              hint="Sudah punya akun AirSense"
              onPress={() => go("/login")}
            />
            <SettingsRow
              icon={<Bell size={20} color={notificationsAllowed === false ? "#B42318" : DARK} />}
              label="Izin notifikasi"
              hint={
                notificationsAllowed === false
                  ? "Mati — ketuk untuk mengaktifkan di pengaturan HP"
                  : "Aktif"
              }
              onPress={() => void Linking.openSettings()}
            />
            {owners.map((owner) => (
              <SettingsRow
                key={owner.inviteId}
                icon={<UserX size={20} color="#B42318" />}
                label={`Berhenti memantau ${owner.ownerName}`}
                hint="Tidak lagi menerima peringatan darurat"
                danger
                busy={leaving === owner.inviteId}
                onPress={() => leave(owner)}
              />
            ))}
            {owners.length > 0 ? (
              <Text style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Notifikasi kontak darurat tetap aktif walaupun Anda membuat akun atau masuk.
              </Text>
            ) : null}
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const guest = useGuestState();
  const notificationsAllowed = useNotificationsAllowed();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const isGuest = guest.owners.length > 0;

  const openAlert = (alert: GuestAlert) =>
    router.push({ pathname: "/emergency-alert", params: alert.params });

  return (
    <LinearGradient
      colors={["#D9E4D7", "#FDEFCC"]}
      locations={[0, 0.6834]}
      start={{ x: 1, y: 0.1 }}
      end={{ x: 0, y: 0.9 }}
      style={{ flex: 1 }}
    >
      <Image
        source={require("@/assets/images/ENTRY APP.png")}
        resizeMode="contain"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "80%",
          width: "100%",
        }}
      />

      {/* Kanan atas: posisi umum tombol pengaturan di Android (kiri atas untuk kembali) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pengaturan"
        onPress={() => setSettingsOpen(true)}
        hitSlop={8}
        style={{
          position: "absolute",
          top: insets.top + 10,
          right: 16,
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: "rgba(255,255,255,0.85)",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 2,
        }}
      >
        <Settings size={22} color={DARK} />
      </Pressable>

      <View style={{ flex: 1 }} />

      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 18,
          backgroundColor: "#F9FAF8",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: "75%",
        }}
      >
        <SafeAreaView edges={["bottom"]} style={{ paddingBottom: 12, flexShrink: 1 }}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 26, marginRight: 6 }}>🍃</Text>
              <Text
                style={{ fontSize: 26, fontWeight: "700", color: COLORS.green }}
              >
                AirSense
              </Text>
            </View>

            {isGuest ? (
              <GuestCard
                owners={guest.owners}
                alerts={guest.alerts}
                notificationsAllowed={notificationsAllowed}
                onOpenAlert={openAlert}
              />
            ) : (
              <>
                <Text
                  style={{
                    fontSize: 28,
                    fontWeight: "700",
                    color: "#000",
                    textAlign: "center",
                    lineHeight: 34,
                  }}
                >
                  Pantau Udara,{"\n"}Jaga Kesehatan
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: "#374151",
                    textAlign: "center",
                    lineHeight: 22,
                    marginTop: 8,
                    marginBottom: 12,
                  }}
                >
                  Informasi kualitas udara dan kondisi tubuh untuk perjalanan yang
                  lebih aman.
                </Text>
              </>
            )}
          </ScrollView>

          <PrimaryButton label="Mulai" onPress={() => router.push("/login")} />
        </SafeAreaView>
      </View>

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        owners={guest.owners}
        notificationsAllowed={notificationsAllowed}
      />
    </LinearGradient>
  );
}
