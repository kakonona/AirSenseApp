import { MaterialIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type NavTabKey = "home" | "history" | "friends" | "settings";

type NavItem = {
  key: NavTabKey;
  iconName: keyof typeof MaterialIcons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  { key: "home", iconName: "home" },
  { key: "history", iconName: "history" },
  { key: "friends", iconName: "people" },
  { key: "settings", iconName: "settings" },
];

type BottomNavbarProps = {
  activeTab: NavTabKey;
  onTabPress: (tab: NavTabKey) => void;
};

export default function BottomNavbar({
  activeTab,
  onTabPress,
}: BottomNavbarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrapper, { bottom: Math.max(12, insets.bottom + 12) }]}
      pointerEvents="box-none"
    >
      <BlurView intensity={18} tint="light" style={styles.bar}>
        <View style={styles.tint} />
        {NAV_ITEMS.map(({ key, iconName }) => {
          const isActive = activeTab === key;

          return (
            <Pressable
              key={key}
              onPress={() => onTabPress(key)}
              style={[styles.item, isActive && styles.itemActive]}
              hitSlop={8}
            >
              <MaterialIcons
                name={iconName}
                size={22}
                color={isActive ? "#1a1a1a" : "rgba(30,30,30,0.65)"}
              />
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 24,
    left: 24,
    right: 24,
    alignItems: "center",
  },
  bar: {
    width: "100%",
    height: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  tint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    padding: 10,
  },
  itemActive: {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
});
