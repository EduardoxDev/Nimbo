export type ThemeValues = {
  appearanceMode: "classic" | "liquidGlass";
  islandBackgroundColor: string;
  pulseColor: string;
  taskTextColor: string;
  glassTint: number;
  glassIntensity: number;
  opacity: number;
};

export type ThemePreset = { id: string; background: string; accent: string };

export const THEME_PRESETS: ThemePreset[] = [
  { id: "graphite", background: "#2F2F37", accent: "#3ae489" },
  { id: "noir", background: "#0A0A0D", accent: "#f5f5f7" },
  { id: "midnight", background: "#0B0B12", accent: "#7f86ff" },
  { id: "ocean", background: "#0F2A3D", accent: "#5ac8fa" },
  { id: "plum", background: "#2A1838", accent: "#bf5af2" },
  { id: "forest", background: "#13261C", accent: "#35e985" },
  { id: "ember", background: "#2D1712", accent: "#ff9f0a" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const THEME_MARKER = "nimboTheme";

export function exportTheme(values: ThemeValues) {
  return JSON.stringify({ [THEME_MARKER]: 1, ...values });
}

function percent(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;
}

export function parseTheme(text: string): Partial<ThemeValues> | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || parsed[THEME_MARKER] !== 1) return null;
  const theme: Partial<ThemeValues> = {};
  if (parsed.appearanceMode === "classic" || parsed.appearanceMode === "liquidGlass") {
    theme.appearanceMode = parsed.appearanceMode;
  }
  for (const key of ["islandBackgroundColor", "pulseColor", "taskTextColor"] as const) {
    const value = parsed[key];
    if (typeof value === "string" && HEX.test(value)) theme[key] = value;
  }
  const tint = percent(parsed.glassTint, 0, 100);
  if (tint !== null) theme.glassTint = tint;
  const intensity = percent(parsed.glassIntensity, 25, 100);
  if (intensity !== null) theme.glassIntensity = intensity;
  const opacity = percent(parsed.opacity, 50, 100);
  if (opacity !== null) theme.opacity = opacity;
  return Object.keys(theme).length > 0 ? theme : null;
}
