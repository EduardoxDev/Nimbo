// The island opens on the page that fits what you are doing: a meeting shows the agenda,
// an agent at work while you code shows the agents, a running focus shows the timer, music shows the player.

export type ContextPage = "calendar" | "agents" | "focus" | "music";

export type ContextSignals = {
  /** Executable of the window in front, like "Code.exe". */
  app: string | null;
  meeting: boolean;
  agentBusy: boolean;
  focusRunning: boolean;
  musicPlaying: boolean;
};

export type ContextMemory = {
  /** The last page the context pointed to, so the island only moves when the context changes. */
  lastSuggested: ContextPage | null;
  /** When you last picked a page yourself. */
  manualAt: number;
};

/** After you pick a page yourself, the island leaves it alone for this long. */
export const MANUAL_HOLD_MS = 10 * 60_000;

const CODE_APPS = /^(code|code - insiders|cursor|windsurf|zed|devenv|idea64|pycharm64|webstorm64|rider64|clion64|goland64|android studio|studio64|sublime_text|windowsterminal|wt|powershell|pwsh|cmd|alacritty|wezterm-gui|warp)$/;
const MUSIC_APPS = /^(spotify|applemusic|music\.ui|deezer|tidal|amazon music|itunes|foobar2000|aimp|musicbee)$/;

function appName(app: string | null) {
  return (app ?? "").split(/[\\/]/).pop()!.replace(/\.exe$/i, "").trim().toLowerCase();
}

export function contextPageOf(signals: ContextSignals): ContextPage | null {
  if (signals.meeting) return "calendar";
  const app = appName(signals.app);
  if (signals.agentBusy && CODE_APPS.test(app)) return "agents";
  if (signals.focusRunning) return "focus";
  if (signals.musicPlaying || MUSIC_APPS.test(app)) return "music";
  return null;
}

export function initialContextMemory(): ContextMemory {
  return { lastSuggested: null, manualAt: 0 };
}

/**
 * Decides whether to move the island now. It only moves while the island is closed (never under your
 * cursor), only when the context changed, and never right after you chose a page yourself.
 */
export function nextContextPage(
  memory: ContextMemory,
  suggestion: ContextPage | null,
  current: string,
  now: number,
  islandOpen: boolean,
): { page: ContextPage | null; memory: ContextMemory } {
  if (islandOpen || suggestion === memory.lastSuggested) return { page: null, memory };
  const remembered = { ...memory, lastSuggested: suggestion };
  if (!suggestion || suggestion === current || now - memory.manualAt < MANUAL_HOLD_MS) return { page: null, memory: remembered };
  return { page: suggestion, memory: remembered };
}
