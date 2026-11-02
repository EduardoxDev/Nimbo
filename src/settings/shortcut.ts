import type { KeyboardEvent } from "react";

export type ShortcutAction = "toggle" | "playPause" | "nextPage" | "settings" | "launcher" | "voice" | "screen" | "draw" | "lens" | "readAloud" | "colorPick";
export const SHORTCUT_ACTIONS: ShortcutAction[] = ["toggle", "launcher", "lens", "readAloud", "colorPick", "voice", "screen", "draw", "playPause", "nextPage", "settings"];
export type Shortcuts = Record<ShortcutAction, string>;
export type ShortcutResult = { action: ShortcutAction; shortcut: string; error: string | null };

export const DEFAULT_SHORTCUTS: Shortcuts = {
  toggle: "Alt+Shift+N",
  launcher: "Alt+Shift+Space",
  voice: "Alt+Shift+M",
  screen: "Alt+Shift+S",
  draw: "Alt+Shift+D",
  lens: "Alt+Shift+L",
  readAloud: "Alt+Shift+R",
  colorPick: "Alt+Shift+P",
  playPause: "",
  nextPage: "",
  settings: "",
};

const RETIRED_DEFAULTS: Partial<Shortcuts> = { toggle: "Ctrl+Alt+Space" };

export function normalizeShortcuts(value: unknown): Shortcuts {
  const raw = value && typeof value === "object" ? (value as Partial<Shortcuts>) : {};
  const stored = Object.fromEntries(
    Object.entries(raw).filter(([action, shortcut]) => RETIRED_DEFAULTS[action as ShortcutAction] !== shortcut),
  ) as Partial<Shortcuts>;
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [
      action,
      typeof stored[action] === "string" ? stored[action] : DEFAULT_SHORTCUTS[action],
    ]),
  ) as Shortcuts;
}

export function shortcutRequests(shortcuts: Shortcuts) {
  return SHORTCUT_ACTIONS.map((action) => ({ action, shortcut: shortcuts[action] }));
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">) {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Win"].filter(Boolean);
  if (!modifiers.length) return null;
  const key = event.key === " " || event.key === "Spacebar" ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}
