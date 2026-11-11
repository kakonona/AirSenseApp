import {
    AuthInput,
    COLORS,
    FormMessage,
    PrimaryButton,
    type Message,
} from "@/components/auth-ui";
import { useAuth } from "@/context/auth-context";
import {
    useContacts,
    type Contact,
    type MonitoredUser,
} from "@/hooks/use-device";
import {
    addUserByEmail,
    createInvitation,
    removeWatcher,
    respondToInvite,
} from "@/lib/sharing";
import * as Clipboard from "expo-clipboard";
import React from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";

const DARK = "#1f3a2e";

const errText = (e: any) =>
  e?.code === "permission-denied"
    ? "Akses ditolak, cek Rules Firestore / Realtime Database"
    : e?.message || "Gagal, coba lagi";

function useMe() {
  const { user } = useAuth();
  return React.useMemo(
    () =>
      user
        ? {
            uid: user.uid,
            name: user.displayName || user.email?.split("@")[0] || "Pengguna",
            email: user.email ?? "",
          }
        : null,
    [user],
  );
}

function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: "#fff",
              borderRadius: 24,
              padding: 20,
              maxHeight: "85%",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: "700", color: DARK }}>
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <Text style={{ fontSize: 20, color: COLORS.muted }}>✕</Text>
              </Pressable>
            </View>
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Tambahkan Pengguna: email + link undangan ────────────────────────────────
export function AddUserModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const me = useMe();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Message | null>(null);
  const [link, setLink] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!visible) {
      setEmail("");
      setMsg(null);
      setLink("");
      setCopied(false);
    }
  }, [visible]);

  const add = async () => {
    if (!me) return;
    setBusy(true);
    setMsg(null);
    try {
      await addUserByEmail(me, email);
      setEmail("");
      setMsg({
        type: "info",
        text: "Permintaan terkirim, menunggu persetujuan",
      });
    } catch (e) {
      setMsg({ type: "error", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!me) return;
    setMsg(null);
    try {
      setLink(await createInvitation(me));
      setCopied(false);
    } catch (e) {
      setMsg({ type: "error", text: errText(e) });
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Tambahkan Pengguna">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AuthInput
          icon="email"
          placeholder="Email pengguna"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <FormMessage message={msg} />
        <PrimaryButton label="Tambahkan" onPress={add} loading={busy} />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginVertical: 18,
          }}
        >
          <View style={{ flex: 1, height: 1, backgroundColor: "#E5E7EB" }} />
          <Text
            style={{ marginHorizontal: 10, fontSize: 11, color: COLORS.muted }}
          >
            atau undang tamu (tanpa akun)
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: "#E5E7EB" }} />
        </View>

        {link ? (
          <View>
            <View
              style={{
                backgroundColor: COLORS.field,
                borderRadius: 16,
                padding: 12,
                marginBottom: 10,
              }}
            >
              <Text selectable style={{ fontSize: 12, color: "#374151" }}>
                {link}
              </Text>
            </View>
            <PrimaryButton
              label={copied ? "Tersalin ✓" : "Salin Link"}
              onPress={copy}
            />
            <Text
              style={{
                fontSize: 11,
                color: COLORS.muted,
                textAlign: "center",
                marginTop: 10,
              }}
            >
              Berlaku 24 jam, sekali pakai
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={generate}
            style={({ pressed }) => ({
              borderWidth: 1.5,
              borderColor: COLORS.green,
              borderRadius: 24,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{ color: COLORS.green, fontSize: 15, fontWeight: "600" }}
            >
              Buat Link Undangan
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </Sheet>
  );
}

// ── Bagikan Akses Pemantauan: daftar yang memantau saya ──────────────────────
const STATUS_LABEL = {
  pending: "Menunggu",
  accepted: "Aktif",
  rejected: "Ditolak",
} as const;
const STATUS_COLOR = {
  pending: "#C9A227",
  accepted: "#3F8F5E",
  rejected: "#C15C55",
} as const;

export function ShareAccessModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const contacts = useContacts(user?.uid);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<Message | null>(null);

  React.useEffect(() => {
    if (!visible) {
      setConfirmId(null);
      setMsg(null);
    }
  }, [visible]);

  const remove = async (c: Contact) => {
    if (!user) return;
    if (confirmId !== c.contactId) {
      setConfirmId(c.contactId); // tap pertama = minta konfirmasi
      return;
    }
    try {
      await removeWatcher(user.uid, c);
    } catch (e) {
      setMsg({ type: "error", text: errText(e) });
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Akses Pemantauan">
      <Text style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>
        Orang yang dapat melihat atau memantau kondisi kamu
      </Text>
      <FormMessage message={msg} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {contacts.length === 0 ? (
          <Text
            style={{
              textAlign: "center",
              color: "#6b7280",
              paddingVertical: 20,
            }}
          >
            Belum ada yang memantau kamu
          </Text>
        ) : (
          contacts.map((c) => (
            <View
              key={c.contactId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: COLORS.field,
                borderRadius: 18,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: DARK }}>
                  {c.name}
                </Text>
                <Text style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  {c.type === "guest"
                    ? `Tamu${c.phone ? ` · ${c.phone}` : ""}`
                    : "Pengguna terdaftar"}
                  {"  ·  "}
                  <Text
                    style={{ color: STATUS_COLOR[c.status], fontWeight: "600" }}
                  >
                    {STATUS_LABEL[c.status]}
                  </Text>
                </Text>
              </View>
              <Pressable
                onPress={() => remove(c)}
                hitSlop={8}
                style={{
                  backgroundColor:
                    confirmId === c.contactId ? "#FEE2E2" : "#fff",
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
              >
                <Text
                  style={{ fontSize: 12, fontWeight: "600", color: "#DC2626" }}
                >
                  {confirmId === c.contactId ? "Yakin?" : "Hapus"}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}

// ── Kartu permintaan masuk (di halaman Monitor) ──────────────────────────────
export function InviteCard({ invite }: { invite: MonitoredUser }) {
  const { user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const answer = async (accept: boolean) => {
    if (!user) return;
    setBusy(true);
    setErr("");
    try {
      await respondToInvite(user.uid, invite.target_uid, accept);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const btn = (
    label: string,
    bg: string,
    color: string,
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{
        flex: 1,
        backgroundColor: bg,
        borderRadius: 18,
        paddingVertical: 10,
        alignItems: "center",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "600", color }}>{label}</Text>
    </Pressable>
  );

  return (
    <View
      style={{
        backgroundColor: "#fff",
        borderRadius: 24,
        padding: 14,
        marginBottom: 12,
        elevation: 3,
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Text style={{ fontSize: 14, color: DARK }}>
        <Text style={{ fontWeight: "700" }}>{invite.target_name}</Text> ingin
        kamu memantau kondisinya
      </Text>
      {err ? (
        <Text style={{ fontSize: 12, color: COLORS.error, marginTop: 6 }}>
          {err}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {btn("Tolak", COLORS.field, "#374151", () => answer(false))}
        {btn("Terima", COLORS.green, "#fff", () => answer(true))}
      </View>
    </View>
  );
}
