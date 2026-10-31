import { weatherKind } from "../weather/weather";

export type MascotAccessory = "nightcap" | "umbrella" | "sunglasses" | "headphones" | "tophat" | "crown" | "glasses" | "beret";

const APP_OUTFITS: [RegExp, MascotAccessory][] = [
  [/^(code|cursor|devenv|idea64|pycharm64|webstorm64|windowsterminal|warp|wezterm-gui|alacritty|virillio.*)\.exe$/, "glasses"],
  [/^(spotify|discord.*|tidal|deezer|vlc|wmplayer|music\.ui)\.exe$/, "headphones"],
  [/^(figma|photoshop|illustrator|mspaint|krita|blender|clipchamp|afterfx|premiere.*)\.exe$/, "beret"],
];

export function appAccessory(app: string): MascotAccessory | null {
  const name = app.toLowerCase();
  return APP_OUTFITS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

const EARNED: [number, MascotAccessory][] = [
  [5, "crown"],
  [4, "tophat"],
  [2, "headphones"],
];

export function contextAccessory(hour: number, weather: { code: number; isDay: boolean } | null): MascotAccessory | null {
  if (hour >= 23 || hour < 6) return "nightcap";
  if (!weather) return null;
  const kind = weatherKind(weather.code);
  if (kind === "rain" || kind === "drizzle" || kind === "storm") return "umbrella";
  if (kind === "clear" && weather.isDay) return "sunglasses";
  return null;
}

export function earnedAccessory(level: number): MascotAccessory | null {
  return EARNED.find(([minimum]) => level >= minimum)?.[1] ?? null;
}

export function mascotAccessory(hour: number, weather: { code: number; isDay: boolean } | null, level: number) {
  return contextAccessory(hour, weather) ?? earnedAccessory(level);
}
