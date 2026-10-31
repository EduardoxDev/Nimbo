export type BuddyMode = "off" | "free" | "cursor";

export const BUDDY_MODES: BuddyMode[] = ["off", "free", "cursor"];

export function isBuddyMode(value: unknown): value is BuddyMode {
  return typeof value === "string" && (BUDDY_MODES as string[]).includes(value);
}

export function readBuddyMode(): BuddyMode {
  try {
    const settings = JSON.parse(window.localStorage.getItem("nimbo-settings") ?? "{}") as { buddyMode?: unknown };
    return isBuddyMode(settings.buddyMode) ? settings.buddyMode : "off";
  } catch {
    return "off";
  }
}
