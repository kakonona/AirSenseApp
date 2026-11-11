import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";

/**
 * Root page background, translated from:
 *
 *   background:
 *     linear-gradient(0deg, rgba(238,240,242,0.66) 0%, rgba(238,240,242,0.66) 100%),
 *     linear-gradient(169deg, #A8D3B9 0%, #FDEA70 123.15%),
 *     #EEF0F2;
 *
 * React Native has no multi-layer `background` shorthand, so each CSS
 * layer becomes its own stacked View, bottom layer first:
 *   1. #EEF0F2 solid base
 *   2. 169deg diagonal gradient, green → yellow (the 123.15% stop means
 *      the yellow never fully resolves within the visible box — approximated
 *      here by ending the gradient's second color a bit before the bottom edge)
 *   3. a flat translucent wash on top (the 0deg "gradient" between two
 *      identical color stops is just a solid semi-transparent fill)
 */
export function ScreenBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      {/* layer 1: solid base */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#EEF0F2" }]} />

      {/* layer 2: 169deg diagonal gradient, green → yellow */}
      <LinearGradient
        colors={["#A8D3B9", "#FDEA70"]}
        // 169deg in CSS is nearly vertical (top → bottom), tilted slightly
        // toward the right. start/end below approximate that direction.
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        // the CSS stop sits at 123.15%, past the box's bottom edge, so the
        // yellow never fully "arrives" on screen — stopping locations
        // just short of 1 approximates that same clipped feel.
        locations={[0, 0.81]}
        style={StyleSheet.absoluteFill}
      />

      {/* layer 3: flat translucent wash on top */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(238, 240, 242, 0.76)" },
        ]}
      />

      {/* actual screen content, on top of all background layers */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
