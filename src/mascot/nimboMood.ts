import type { MascotMood } from "./engine";

export const NIMBO_COLOR = "#f2f2f5";

export type NimboContext = {
  hour: number;
  focusRunning: boolean;
  assistantBusy: boolean;
  needsAttention: boolean;
  justFinished: boolean;
  musicPlaying: boolean;
};

export function nimboMood(context: NimboContext): MascotMood {
  if (context.needsAttention) return "waiting";
  if (context.justFinished) return "done";
  if (context.assistantBusy) return "thinking";
  if (context.focusRunning) return "working";
  if (!context.musicPlaying && (context.hour >= 23 || context.hour < 6)) return "sleeping";
  return "idle";
}

export const STATUS_COLORS = {
  music: "#ff375f",
  focus: "#ff9f0a",
  calendar: "#ff453a",
  water: "#5ac8fa",
  assistant: "#bf8cff",
} as const;

export function statusDots(active: Partial<Record<keyof typeof STATUS_COLORS, boolean>>, agentColors: string[]) {
  const modules = (Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[])
    .filter((key) => active[key])
    .map((key) => STATUS_COLORS[key]);
  return [...agentColors, ...modules].slice(0, 4);
}
