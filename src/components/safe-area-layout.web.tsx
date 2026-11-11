import type { PropsWithChildren } from "react";
import { View } from "react-native";
import "../safe-area.css";

export default function SafeAreaLayout({ children }: PropsWithChildren) {
  return (
    <View className="safe-area-layout" style={{ flex: 1 }}>
      {children}
    </View>
  );
}
