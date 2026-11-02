export type BuddyMode = "off" | "free" | "cursor";

export const BUDDY_MODES: BuddyMode[] = ["off", "free", "cursor"];

export function isBuddyMode(value: unknown): value is BuddyMode {
  return typeof value === "string" && (BUDDY_MODES as string[]).includes(value);
}

export const DEFAULT_DOCK_LIFT = 88;

export function readDockLift(): number {
  try {
    const settings = JSON.parse(window.localStorage.getItem("nimbo-settings") ?? "{}") as { buddyDockLift?: unknown };
    const lift = Number(settings.buddyDockLift);
    return Number.isFinite(lift) ? Math.min(240, Math.max(0, lift)) : DEFAULT_DOCK_LIFT;
  } catch {
    return DEFAULT_DOCK_LIFT;
  }
}

export function readBuddyMode(): BuddyMode {
  try {
    const settings = JSON.parse(window.localStorage.getItem("nimbo-settings") ?? "{}") as { buddyMode?: unknown };
    return isBuddyMode(settings.buddyMode) ? settings.buddyMode : "off";
  } catch {
    return "off";
  }
}
