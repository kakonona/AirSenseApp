import BottomNavbar from "@/components/navbar";
import { ScreenBackground } from "@/components/screen-background";
import { useAuth } from "@/context/auth-context";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { downloadHistoryCsv } from "@/lib/history-export";
import { MaterialIcons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function MenuItem({
  label,
  icon,
  color = "#111827",
  italic = false,
  disabled = false,
  loading = false,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  color?: string;
  italic?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      android_ripple={{ color: "#E5E7EB" }}
      style={{
        backgroundColor: "#fff",
        borderRadius: 24,
        borderColor: "#E5E7EB",
        borderWidth: 1,
        paddingVertical: 13,
        paddingHorizontal: 18,
        marginBottom: 12,
        flexDirection: "row",
        alignItems: "center",
        opacity: disabled ? 0.6 : 1,
        overflow: "hidden",
        elevation: 2,
        shadowColor: "#000",
        shadowOpacity: 0.05,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      {loading ? (
        <ActivityIndicator size={20} color={color} />
      ) : (
        <MaterialIcons name={icon} size={20} color={color} />
      )}
      <Text
        style={{
          marginLeft: 12,
          fontSize: 15,
          color,
          fontStyle: italic ? "italic" : "normal",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const goTo = useTabNavigation();
  const { user, signOut } = useAuth();
  const [busyAction, setBusyAction] = React.useState<
    "download" | "logout" | null
  >(null);
  const [notice, setNotice] = React.useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const handleDownload = async () => {
    if (busyAction) return;
    if (!user) {
      setNotice({ type: "error", message: "Silakan login kembali." });
      return;
    }
    setNotice(null);
    setBusyAction("download");
    try {
      const { count, filename } = await downloadHistoryCsv(user.uid);
      if (count === 0) {
        setNotice({
          type: "info",
          message: "Riwayat Anda belum memiliki data untuk diunduh.",
        });
        return;
      }
      setNotice({
        type: "success",
        message: `${count} data riwayat berhasil diekspor ke ${filename}.`,
      });
    } catch (error) {
      console.error("Gagal mengunduh riwayat:", error);
      setNotice({
        type: "error",
        message:
          error instanceof Error
            ? `Unduhan gagal: ${error.message}`
            : "Unduhan gagal. Silakan coba lagi.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = async () => {
    if (busyAction) return;
    setNotice(null);
    setBusyAction("logout");
    try {
      await signOut();
    } catch (error) {
      console.error("Gagal logout:", error);
      setNotice({
        type: "error",
        message:
          error instanceof Error
            ? `Logout gagal: ${error.message}`
            : "Logout gagal. Silakan coba lagi.",
      });
      setBusyAction(null);
    }
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 120,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text
            style={{
              fontSize: 22,
              fontWeight: "700",
              color: "#111827",
              marginBottom: 20,
            }}
          >
            Pengaturan
          </Text>

          {notice ? (
            <View
              accessibilityRole="alert"
              style={{
                marginBottom: 14,
                padding: 12,
                borderRadius: 14,
                backgroundColor:
                  notice.type === "error"
                    ? "#FEF2F2"
                    : notice.type === "success"
                      ? "#F0F7F1"
                      : "#F3F4F6",
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  lineHeight: 19,
                  color:
                    notice.type === "error"
                      ? "#B91C1C"
                      : notice.type === "success"
                        ? "#356347"
                        : "#4B5563",
                }}
              >
                {notice.message}
              </Text>
            </View>
          ) : null}

          <MenuItem
            label={
              busyAction === "download"
                ? "Mengunduh..."
                : "Unduh History Data"
            }
            icon="archive"
            disabled={busyAction !== null}
            loading={busyAction === "download"}
            onPress={handleDownload}
          />
          <MenuItem
            label={busyAction === "logout" ? "Keluar..." : "Logout"}
            icon="logout"
            color="#EF4444"
            italic
            disabled={busyAction !== null}
            loading={busyAction === "logout"}
            onPress={handleLogout}
          />
        </ScrollView>

        <BottomNavbar activeTab="settings" onTabPress={goTo} />
      </SafeAreaView>
    </ScreenBackground>
  );
}
