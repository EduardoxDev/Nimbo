import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect, SvgXml } from "react-native-svg";

export const colors = {
  background: "#050507",
  island: "#000000",
  card: "rgba(255,255,255,0.07)",
  line: "rgba(255,255,255,0.08)",
  text: "#f5f5f7",
  muted: "rgba(245,245,247,0.55)",
  blue: "#64d2ff",
  music: "#ff375f",
  focus: "#ff9f0a",
  tasks: "#35e985",
  water: "#5ac8fa",
  notices: "#ffd60a",
  pc: "#bf8cff",
  ai: "#bf8cff",
};

/** The same mascot the PC island shows (it sends the drawing), or a plain cloud. */
export function Mascot({ svg, size }: { svg?: string; size: number }) {
  if (svg) return <SvgXml xml={svg} width={size} height={size} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M28 74c-11 0-19-8-19-18 0-9 7-17 16-18 3-12 13-20 25-20 13 0 23 9 25 21 9 1 16 8 16 17 0 10-8 18-18 18z" fill="#f2f2f5" />
      <Rect x="38" y="44" width="7" height="14" rx="3.5" fill="#000" />
      <Rect x="56" y="44" width="7" height="14" rx="3.5" fill="#000" />
    </Svg>
  );
}

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  music: "M9 18V5l12-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  focus: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M9 2h6",
  tasks: "m9 11 3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  water: "M12 2.7s6 6.4 6 11.3a6 6 0 0 1-12 0c0-4.9 6-11.3 6-11.3z",
  notices: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  pc: "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4",
  check: "M20 6 9 17l-5-5",
};

export function Icon({ name, size = 20, color = colors.text }: { name: keyof typeof ICONS | "play" | "pause" | "prev" | "next"; size?: number; color?: string }) {
  if (name === "play") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M7 4v16l13-8z" fill={color} />
      </Svg>
    );
  }
  if (name === "pause") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
        <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
      </Svg>
    );
  }
  if (name === "prev" || name === "next") {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" style={name === "next" ? { transform: [{ scaleX: -1 }] } : undefined}>
        <Path d="M19 20 9 12l10-8z" fill={color} />
        <Rect x="4" y="5" width="2.4" height="14" rx="1" fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICONS[name]} />
    </Svg>
  );
}

export function Ring({ size, progress, color }: { size: number; progress: number; color: string }) {
  const radius = size / 2 - 8;
  const length = 2 * Math.PI * radius;
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.1)" strokeWidth={12} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={12} strokeLinecap="round" fill="none" strokeDasharray={`${length}`} strokeDashoffset={length * (1 - progress)} />
    </Svg>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ label, onPress, accent, danger, style }: { label: string; onPress: () => void; accent?: string; danger?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, accent ? { backgroundColor: accent } : null, danger ? { backgroundColor: "rgba(255,69,58,0.85)" } : null, pressed && { transform: [{ scale: 0.97 }] }, style]}
    >
      <Text style={[styles.buttonText, accent ? { color: "#000" } : null]}>{label}</Text>
    </Pressable>
  );
}

export function clock(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export const styles = StyleSheet.create({
  card: { marginBottom: 10, padding: 14, backgroundColor: colors.card, borderRadius: 22 },
  button: { flex: 1, flexShrink: 0, minWidth: 88, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 16 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  label: { marginBottom: 8, color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  big: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13 },
  row: { flexDirection: "row", gap: 8 },
  input: { minHeight: 48, paddingHorizontal: 14, color: colors.text, fontSize: 15, backgroundColor: "rgba(0,0,0,0.45)", borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
});
