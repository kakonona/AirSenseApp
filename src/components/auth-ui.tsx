import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
  type TextInputProps,
} from "react-native";
import Svg, { Path } from "react-native-svg";

export const COLORS = {
  bg: "#FAF9F6",
  green: "#6B9E7E",
  greenLight: "#A8D3B9",
  field: "#F0F1F3",
  text: "#111827",
  muted: "#9CA3AF",
  error: "#DC2626",
};

export const SCRIPT_FONT = "Adelia";

const styles = StyleSheet.create({
  title: {
    fontFamily: SCRIPT_FONT,
    fontSize: 28,
    color: "#174C3C",
    marginBottom: 6,
    paddingTop: 40,
    textDecorationLine: "underline",
    textDecorationColor: "#6B9E7E",
  },

  subtitle: {
    fontFamily: "PlusJakartaSans_400Regular",
    fontSize: 12,
    color: "#777777",
    letterSpacing: 0.2,
  },
  primaryButton: {
    backgroundColor: COLORS.green,
    borderRadius: 24,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    elevation: 2,
  },
  googleButton: {
    backgroundColor: COLORS.field,
    borderColor: "#D1D5DB",
    borderWidth: 1,
    borderRadius: 24,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    elevation: 1,
  },
});

export type Message = { type: "error" | "info"; text: string };

export function AuthScreenBackground({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1, overflow: "hidden" }}>
      <LinearGradient
        colors={["#F9FAF8", "#F9FAF8"]}
        start={{ x: 0.76, y: 0 }}
        end={{ x: 0.24, y: 1 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "123.15%",
        }}
      />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

export function AuthHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

export function Landscape({ source }: { source?: ImageSourcePropType }) {
  return (
    <Image
      source={source ?? require("@/assets/images/auth-landscape.png")}
      resizeMode="contain"
      style={{ width: "100%", height: 150 }}
    />
  );
}

type AuthInputProps = TextInputProps & {
  icon: "person" | "lock" | "email";
  secure?: boolean;
};

export function AuthInput({ icon, secure, ...props }: AuthInputProps) {
  const [hidden, setHidden] = React.useState(!!secure);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: COLORS.field,
        borderRadius: 24,
        paddingHorizontal: 16,
        height: 48,
        marginBottom: 14,
      }}
    >
      <MaterialIcons name={icon} size={20} color="#8B8F97" />
      <TextInput
        {...props}
        secureTextEntry={hidden}
        placeholderTextColor="#8B8F97"
        style={[
          {
            flex: 1,
            marginLeft: 10,
            fontSize: 14,
            color: COLORS.text,
            height: "100%",
          },
          Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null,
        ]}
      />
      {secure && (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8}>
          <MaterialIcons
            name={hidden ? "visibility-off" : "visibility"}
            size={20}
            color="#6B7280"
          />
        </Pressable>
      )}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      android_ripple={{ color: "#4F8063" }}
      style={styles.primaryButton}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={{ color: "#fff", fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function OrDivider() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginVertical: 16,
      }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: "#D1D5DB" }} />
      <Text style={{ marginHorizontal: 10, fontSize: 11, color: COLORS.muted }}>
        Atau lanjutkan dengan
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: "#D1D5DB" }} />
    </View>
  );
}

export function GoogleButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: "#D8DDE2" }}
      style={styles.googleButton}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          fill="#4285F4"
          d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
        />
        <Path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
        />
        <Path
          fill="#FBBC05"
          d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
        />
        <Path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
        />
      </Svg>
      <Text
        style={{
          marginLeft: 8,
          fontSize: 15,
          fontWeight: "500",
          color: "#1F2937",
        }}
      >
        Google
      </Text>
    </Pressable>
  );
}

export function FormMessage({ message }: { message: Message | null }) {
  if (!message || !message.text) return null;
  return (
    <Text
      style={{
        fontSize: 12.5,
        textAlign: "center",
        marginBottom: 10,
        color: message.type === "error" ? COLORS.error : COLORS.green,
      }}
    >
      {message.text}
    </Text>
  );
}

export function LinkText({
  children,
  onPress,
}: {
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Text
      onPress={onPress}
      style={{
        color: COLORS.green,
        fontStyle: "italic",
        fontWeight: "600",
        textDecorationLine: "underline",
      }}
    >
      {children}
    </Text>
  );
}
