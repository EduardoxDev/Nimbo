/**
 * Makes sense of the day recorded by `activity.rs`: names, categories, time
 * per app, what happened at a given hour and a plain-language diary.
 */

export type Segment = { app: string; title: string; start: number; end: number };
export type Category = "work" | "communication" | "distraction" | "other";
export type AppTime = { label: string; ms: number; category: Category };
export type DaySummary = {
  totalMs: number;
  byCategory: Record<Category, number>;
  apps: AppTime[];
  first: number | null;
  last: number | null;
  /** Longest stretch of work without switching to a distraction. */
  longestFocusMs: number;
};

/** One sample is ten seconds; a block seen once still counts that long. */
const SAMPLE_MS = 10_000;
const BROWSERS = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc)\.exe$/;
const BROWSER_SUFFIX = /\s[-–—]\s(Google Chrome|Microsoft​?\s?Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)$/i;

const NAMES: Record<string, string> = {
  "code.exe": "VS Code",
  "winword.exe": "Word",
  "excel.exe": "Excel",
  "powerpnt.exe": "PowerPoint",
  "outlook.exe": "Outlook",
  "olk.exe": "Outlook",
  "ms-teams.exe": "Teams",
  "msteams.exe": "Teams",
  "whatsapp.exe": "WhatsApp",
  "whatsapp.root.exe": "WhatsApp",
  "windowsterminal.exe": "Terminal",
  "devenv.exe": "Visual Studio",
  "notepad.exe": "Bloco de notas",
  "explorer.exe": "Explorador",
  "discord.exe": "Discord",
  "discordcanary.exe": "Discord",
  "spotify.exe": "Spotify",
  "claude.exe": "Claude",
};

const WORK = /^(code|winword|excel|powerpnt|onenote|notion|figma|devenv|idea64|pycharm64|webstorm64|rider64|windowsterminal|wt|powershell|cmd|pwsh|notepad|notepad\+\+|obsidian|claude|cursor|acrobat|acrord32|warp)\.exe$/;
const TALK = /^(ms-teams|msteams|teams|slack|whatsapp|whatsapp\.root|discord|discordcanary|telegram|zoom|outlook|olk|skype|thunderbird)\.exe$/;
const PLAY = /^(steam|steamwebhelper|epicgameslauncher|robloxplayerbeta|leagueclient|riotclientservices|battle\.net|xbox|netflix)\.exe$/;
const PLAY_SITES = /\b(youtube|instagram|tiktok|twitter|facebook|reddit|netflix|twitch|prime video|disney\+|9gag|kwai|pinterest)\b|(^|\s)x\.com\b/i;
const WORK_SITES = /\b(github|gitlab|stack overflow|docs|notion|figma|jira|confluence|linear|vercel|google docs|planilhas|sheets|drive|chatgpt|claude)\b/i;
const TALK_SITES = /\b(gmail|outlook|whatsapp|teams|slack|discord|meet)\b/i;

function capitalize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "Página - YouTube - Google Chrome" → "YouTube"; "App.tsx - nimbo - Visual Studio Code" → "VS Code". */
export function labelOf(segment: Pick<Segment, "app" | "title">) {
  if (BROWSERS.test(segment.app)) {
    const parts = segment.title.replace(BROWSER_SUFFIX, "").split(/\s[-–—|]\s/).map((part) => part.trim()).filter(Boolean);
    const site = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    if (site && site.length <= 32) return site;
  }
  return NAMES[segment.app] ?? capitalize(segment.app.replace(/\.exe$/i, ""));
}

export function categoryOf(segment: Pick<Segment, "app" | "title">): Category {
  if (BROWSERS.test(segment.app)) {
    if (PLAY_SITES.test(segment.title)) return "distraction";
    if (TALK_SITES.test(segment.title)) return "communication";
    if (WORK_SITES.test(segment.title)) return "work";
    return "other";
  }
  if (WORK.test(segment.app)) return "work";
  if (TALK.test(segment.app)) return "communication";
  if (PLAY.test(segment.app)) return "distraction";
  return "other";
}

export function durationOf(segment: Segment) {
  return Math.max(SAMPLE_MS, segment.end - segment.start);
}

export function summarize(segments: Segment[]): DaySummary {
  const byCategory: Record<Category, number> = { work: 0, communication: 0, distraction: 0, other: 0 };
  const apps = new Map<string, AppTime>();
  let longestFocusMs = 0;
  let focusRun = 0;
  for (const segment of segments) {
    const ms = durationOf(segment);
    const category = categoryOf(segment);
    byCategory[category] += ms;
    const label = labelOf(segment);
    const entry = apps.get(label) ?? { label, ms: 0, category };
    entry.ms += ms;
    apps.set(label, entry);
    // Messages and other apps do not break focus; only distractions do.
    focusRun = category === "distraction" ? 0 : focusRun + (category === "work" ? ms : 0);
    longestFocusMs = Math.max(longestFocusMs, focusRun);
  }
  return {
    totalMs: Object.values(byCategory).reduce((sum, ms) => sum + ms, 0),
    byCategory,
    apps: [...apps.values()].sort((a, b) => b.ms - a.ms),
    first: segments[0]?.start ?? null,
    last: segments[segments.length - 1]?.end ?? null,
    longestFocusMs,
  };
}

/** What was in front at a moment, or the closest block within 10 minutes. */
export function segmentAt(segments: Segment[], at: number): Segment | null {
  const inside = segments.find((segment) => segment.start <= at && at <= segment.end + SAMPLE_MS);
  if (inside) return inside;
  let best: Segment | null = null;
  let gap = 10 * 60_000;
  for (const segment of segments) {
    const distance = Math.min(Math.abs(segment.start - at), Math.abs(segment.end - at));
    if (distance < gap) {
      gap = distance;
      best = segment;
    }
  }
  return best;
}

/** Twenty-four buckets: minutes per category in each hour. */
export function hourly(segments: Segment[]) {
  const hours = Array.from({ length: 24 }, () => ({ work: 0, communication: 0, distraction: 0, other: 0 }) as Record<Category, number>);
  for (const segment of segments) {
    const hour = new Date(segment.start).getHours();
    hours[hour][categoryOf(segment)] += durationOf(segment) / 60_000;
  }
  return hours;
}

/** Blocks merged by app for the timeline list, so ten tab switches read as one stretch. */
export function stretches(segments: Segment[], minMs = 60_000) {
  const merged: { label: string; category: Category; start: number; end: number; titles: string[] }[] = [];
  for (const segment of segments) {
    const label = labelOf(segment);
    const last = merged[merged.length - 1];
    if (last && last.label === label && segment.start - last.end < 5 * 60_000) {
      last.end = Math.max(last.end, segment.end);
      if (segment.title && !last.titles.includes(segment.title) && last.titles.length < 3) last.titles.push(segment.title);
      continue;
    }
    merged.push({ label, category: categoryOf(segment), start: segment.start, end: segment.end, titles: segment.title ? [segment.title] : [] });
  }
  return merged.filter((item) => item.end - item.start >= minMs || item.category === "work");
}

export function dayKeyOf(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function minutes(ms: number) {
  return Math.round(ms / 60_000);
}

/** "2 h 15 min", "45 min". */
export function hoursText(ms: number) {
  const total = minutes(ms);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours > 0 ? (rest > 0 ? `${hours} h ${rest} min` : `${hours} h`) : `${rest} min`;
}
