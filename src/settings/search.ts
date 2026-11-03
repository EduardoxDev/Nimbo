import type { Translations } from "../i18n/types";

export type SettingsPageId =
  | "general"
  | "statusRing"
  | "display"
  | "appearance"
  | "music"
  | "todo"
  | "calendar"
  | "pomodoro"
  | "water"
  | "home"
  | "shelf"
  | "hud"
  | "agents"
  | "routines"
  | "automation"
  | "phone"
  | "tools"
  | "about";

export type SettingsGroupId = keyof Translations["prefs"]["groups"];

/** Sidebar groups, in order: a handful of headings instead of one long list. */
export const SETTINGS_GROUPS: { id: SettingsGroupId; pages: SettingsPageId[] }[] = [
  { id: "island", pages: ["general", "appearance", "display", "statusRing", "hud"] },
  { id: "daily", pages: ["todo", "calendar", "pomodoro", "water", "music", "shelf", "tools"] },
  { id: "smart", pages: ["agents", "routines", "automation"] },
  { id: "connected", pages: ["home", "phone"] },
];

/** Where each page's own words live, so a search finds a setting by what it says. */
function pageTexts(t: Translations, page: SettingsPageId): unknown[] {
  const prefs = t.prefs;
  const own: Record<SettingsPageId, unknown[]> = {
    general: [prefs.general],
    statusRing: [prefs.statusRing],
    display: [prefs.display],
    appearance: [prefs.appearance, t.themes],
    music: [prefs.music],
    todo: [prefs.todo],
    calendar: [prefs.calendarPrefs],
    pomodoro: [prefs.pomodoro],
    water: [prefs.waterPrefs],
    home: [prefs.home, prefs.ir],
    shelf: [prefs.shelfPrefs],
    hud: [prefs.hudPrefs],
    agents: [prefs.agents, prefs.assistant, prefs.claudeTask],
    routines: [t.routines],
    automation: [prefs.automations, t.automation, t.automations.open, t.automations.openHint],
    phone: [t.phone],
    tools: [t.tools, t.ambient, t.memory.openWindow, t.memory.openWindowHint],
    about: [prefs.about],
  };
  return [prefs.pages[page], (prefs.soon as Partial<Record<SettingsPageId, string>>)[page], ...own[page]];
}

function collect(value: unknown, out: string[], depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collect(item, out, depth + 1));
  else if (typeof value === "object") Object.values(value).forEach((item) => collect(item, out, depth + 1));
}

export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Pages whose name or contents match every word of the query, best match first. */
export function searchSettings(t: Translations, query: string): SettingsPageId[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const pages = [...SETTINGS_GROUPS.flatMap((group) => group.pages), "about" as const];
  return pages
    .map((page) => {
      const texts: string[] = [];
      collect(pageTexts(t, page), texts);
      const haystack = normalize(texts.join(" \n "));
      const title = normalize(t.prefs.pages[page]);
      if (!words.every((word) => haystack.includes(word))) return null;
      const score = words.reduce((total, word) => total + (title.includes(word) ? 10 : 0), 0);
      return { page, score };
    })
    .filter((match): match is { page: SettingsPageId; score: number } => match !== null)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.page);
}
