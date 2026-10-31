import { isTauri } from "@tauri-apps/api/core";
import type { AppVolume, SystemStats } from "../system/useSystem";

export const SYSTEM_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "system";

export const SYSTEM_DEMO_STATS: SystemStats = {
  cpu: 18,
  memory: 63,
  memoryUsedGb: 10.1,
  memoryTotalGb: 16,
  battery: 74,
  charging: true,
  hasBattery: true,
};

export const SYSTEM_DEMO_APPS: AppVolume[] = [
  { pid: 1, name: "Spotify", volume: 0.8, muted: false },
  { pid: 2, name: "Chrome", volume: 0.45, muted: false },
  { pid: 3, name: "Discord", volume: 0.6, muted: true },
];
