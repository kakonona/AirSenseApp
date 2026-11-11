import { COLORS, PrimaryButton } from "@/components/auth-ui";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WelcomeScreen() {
  const router = useRouter();

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

      <View style={{ flex: 1 }} />

      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 18,
          backgroundColor: "#F9FAF8",
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
      >
        <SafeAreaView edges={["bottom"]} style={{ paddingBottom: 12 }}>
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

          <PrimaryButton label="Mulai" onPress={() => router.push("/login")} />
        </SafeAreaView>
      </View>
    </LinearGradient>
  );
}
