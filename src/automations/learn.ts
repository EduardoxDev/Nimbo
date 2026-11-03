import { labelOf, type Segment } from "../day/activity";
import { actionsOf, type Action, type Rule, type Trigger } from "../rules/rules";

export type DayLog = { day: string; segments: Segment[] };
export type SuggestionKind = "morning" | "followup" | "endOfDay" | "night" | "meeting";
export type Suggestion = {
  id: string;
  kind: SuggestionKind;
  trigger: Trigger;
  actions: Action[];
  apps: string[];
  hits: number;
  total: number;
  score: number;
};
export type LearnState = Record<string, "accepted" | "dismissed">;

export const LEARN_KEY = "nimbo-learn";
export const LEARN_NOTIFIED_KEY = "nimbo-learn-notified";
export const LEARN_DAYS = 14;

const MINUTE = 60_000;
const MIN_ACTIVE_MS = 30 * MINUTE;
const NOISE = /^(explorer|nimbo|searchhost|searchapp|searchui|shellexperiencehost|startmenuexperiencehost|lockapp|applicationframehost|textinputhost|taskmgr|dock_64|systemsettings|rundll32|consent|openwith|mmc|msedgewebview2|sihost|ctfmon|screenclippinghost|snippingtool|shellhost|widgets|widgetboard|gamebar|pickerhost|credentialuibroker|setup|unins000|msiexec)\.exe$/;
const MEETING = /^(zoom|ms-teams|msteams|teams|webex|ciscocollabhost)\.exe$/;
const LAUNCH_NAMES: Record<string, string> = {
  "code.exe": "Visual Studio Code",
  "chrome.exe": "Google Chrome",
  "msedge.exe": "Microsoft Edge",
  "firefox.exe": "Firefox",
  "ms-teams.exe": "Microsoft Teams",
  "msteams.exe": "Microsoft Teams",
  "windowsterminal.exe": "Terminal",
  "winword.exe": "Word",
  "excel.exe": "Excel",
  "powerpnt.exe": "PowerPoint",
  "olk.exe": "Outlook",
  "outlook.exe": "Outlook",
  "discordcanary.exe": "Discord Canary",
  "whatsapp.root.exe": "WhatsApp",
  "obs64.exe": "OBS Studio",
};

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function appName(exe: string) {
  return labelOf({ app: exe, title: "" });
}

export function launchNames(exe: string) {
  const stem = exe.replace(/\.exe$/i, "");
  return [LAUNCH_NAMES[exe], appName(exe), stem].filter((name, index, list): name is string => !!name && list.indexOf(name) === index);
}

export function appToken(exe: string) {
  const stem = exe.replace(/\.exe$/i, "");
  const label = appName(exe);
  return fold(stem).includes(fold(label)) ? label : stem.charAt(0).toUpperCase() + stem.slice(1);
}

function minutesOf(ms: number) {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

function weekdayOf(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).getDay();
}

function clock(minutes: number) {
  const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function deviation(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

const floor5 = (minutes: number) => Math.floor(minutes / 5) * 5;
const useful = (segment: Segment) => !!segment.app && !NOISE.test(segment.app);

function activeLogs(logs: DayLog[]) {
  return logs
    .map((log) => ({ day: log.day, segments: log.segments.filter(useful).sort((a, b) => a.start - b.start) }))
    .filter((log) => log.segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) >= MIN_ACTIVE_MS)
    .sort((a, b) => a.day.localeCompare(b.day));
}

const isWeekday = (day: string) => {
  const weekday = weekdayOf(day);
  return weekday >= 1 && weekday <= 5;
};

function dayStart(log: DayLog) {
  return log.segments.find((segment) => minutesOf(segment.start) >= 4 * 60)?.start ?? null;
}

function morningAppsOf(log: DayLog) {
  const start = dayStart(log);
  const found = new Set<string>();
  if (start === null) return found;
  for (const segment of log.segments) {
    if (segment.start < start) continue;
    if (segment.start - start > 30 * MINUTE) break;
    found.add(segment.app);
  }
  return found;
}

function morning(logs: DayLog[]): Suggestion | null {
  const weekdays = logs.filter((log) => isWeekday(log.day) && dayStart(log) !== null);
  if (weekdays.length < 4) return null;
  const counts = new Map<string, number>();
  const sets = weekdays.map(morningAppsOf);
  for (const set of sets) for (const app of set) counts.set(app, (counts.get(app) ?? 0) + 1);
  const picks = [...counts]
    .filter(([, count]) => count / weekdays.length >= 0.7)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([app]) => app);
  if (picks.length === 0) return null;
  const hits = sets.filter((set) => picks.every((app) => set.has(app))).length;
  if (hits / weekdays.length < 0.6) return null;
  const time = floor5(median(weekdays.map((log) => minutesOf(dayStart(log) ?? 0))));
  if (time < 5 * 60 || time > 12 * 60) return null;
  const weekend = logs.filter((log) => !isWeekday(log.day));
  const everyDay = weekend.length >= 2 && weekend.map(morningAppsOf).filter((set) => picks.every((app) => set.has(app))).length / weekend.length >= 0.7;
  const sorted = [...picks].sort();
  return {
    id: `morning:${sorted.join("+")}`,
    kind: "morning",
    trigger: { kind: "time", time: clock(time), days: everyDay ? [] : [1, 2, 3, 4, 5] },
    actions: picks.map((app) => ({ kind: "open", app: launchNames(app)[0] })),
    apps: picks,
    hits,
    total: weekdays.length,
    score: (hits / weekdays.length) * 1.2,
  };
}

function launchesOf(log: DayLog) {
  const lastSeen = new Map<string, number>();
  const launches: { app: string; at: number }[] = [];
  for (const segment of log.segments) {
    const seen = lastSeen.get(segment.app);
    if (seen === undefined || segment.start - seen > 20 * MINUTE) launches.push({ app: segment.app, at: segment.start });
    lastSeen.set(segment.app, Math.max(seen ?? 0, segment.end));
  }
  return launches;
}

function followups(logs: DayLog[]): Suggestion[] {
  const opened = new Map<string, { count: number; days: Set<string> }>();
  const pairs = new Map<string, number>();
  for (const log of logs) {
    const launches = launchesOf(log);
    launches.forEach((launch, index) => {
      const entry = opened.get(launch.app) ?? { count: 0, days: new Set<string>() };
      entry.count += 1;
      entry.days.add(log.day);
      opened.set(launch.app, entry);
      const next = new Set<string>();
      for (let j = index + 1; j < launches.length && launches[j].at - launch.at <= 3 * MINUTE; j++) if (launches[j].app !== launch.app) next.add(launches[j].app);
      for (const app of next) pairs.set(`${launch.app}>${app}`, (pairs.get(`${launch.app}>${app}`) ?? 0) + 1);
    });
  }
  const found: Suggestion[] = [];
  for (const [key, hits] of pairs) {
    const [from, to] = key.split(">");
    const base = opened.get(from);
    if (!base || base.count < 5 || base.days.size < 3 || hits / base.count < 0.7) continue;
    found.push({
      id: `followup:${from}>${to}`,
      kind: "followup",
      trigger: { kind: "app", app: appToken(from) },
      actions: [{ kind: "open", app: launchNames(to)[0] }],
      apps: [from, to],
      hits,
      total: base.count,
      score: (hits / base.count) * Math.min(1, base.count / 10),
    });
  }
  found.sort((a, b) => b.score - a.score);
  const kept: Suggestion[] = [];
  for (const suggestion of found) {
    if (kept.some((other) => other.apps[0] === suggestion.apps[1] && other.apps[1] === suggestion.apps[0])) continue;
    kept.push(suggestion);
    if (kept.length === 2) break;
  }
  return kept;
}

function endOfDay(logs: DayLog[], sayText: string): Suggestion | null {
  const weekdays = logs.filter((log) => isWeekday(log.day));
  if (weekdays.length < 4) return null;
  const ends = weekdays.map((log) => {
    const afternoon = log.segments.filter((segment) => minutesOf(segment.end) >= 15 * 60);
    const index = afternoon.findIndex((segment, position) => position < afternoon.length - 1 && afternoon[position + 1].start - segment.end >= 90 * MINUTE);
    const last = index >= 0 ? afternoon[index].end : Math.max(...log.segments.map((segment) => segment.end));
    const minutes = minutesOf(last);
    return minutes < 4 * 60 ? minutes + 1440 : minutes;
  });
  if (deviation(ends) > 50) return null;
  const middle = median(ends);
  const time = floor5(middle - 10);
  if (time < 15 * 60 || time > 23 * 60 + 30) return null;
  const hits = ends.filter((value) => Math.abs(value - middle) <= 40).length;
  return {
    id: "endOfDay",
    kind: "endOfDay",
    trigger: { kind: "time", time: clock(time), days: [1, 2, 3, 4, 5] },
    actions: [{ kind: "say", text: sayText }],
    apps: [],
    hits,
    total: weekdays.length,
    score: (hits / weekdays.length) * 0.9,
  };
}

function night(logs: DayLog[]): Suggestion | null {
  if (logs.length < 5) return null;
  const late = logs.filter((log) => log.segments.some((segment) => minutesOf(segment.end) >= 23 * 60 || minutesOf(segment.start) < 4 * 60)).length;
  if (late < 3 || late / logs.length < 0.4) return null;
  return {
    id: "night",
    kind: "night",
    trigger: { kind: "time", time: "22:30", days: [] },
    actions: [{ kind: "dark", on: true }, { kind: "volume", level: 25 }],
    apps: [],
    hits: late,
    total: logs.length,
    score: (late / logs.length) * 0.8,
  };
}

function meeting(logs: DayLog[]): Suggestion | null {
  const apps = new Set<string>();
  let days = 0;
  for (const log of logs) {
    const time = new Map<string, number>();
    for (const segment of log.segments) if (MEETING.test(segment.app)) time.set(segment.app, (time.get(segment.app) ?? 0) + segment.end - segment.start);
    const used = [...time].filter(([, ms]) => ms >= 10 * MINUTE).map(([app]) => app);
    if (used.length > 0) days += 1;
    used.forEach((app) => apps.add(app));
  }
  if (days < 3) return null;
  return {
    id: "meeting",
    kind: "meeting",
    trigger: { kind: "meetingStart" },
    actions: [{ kind: "pause" }],
    apps: [...apps].sort(),
    hits: days,
    total: logs.length,
    score: Math.min(1, days / 5) * 0.85,
  };
}

export function learn(logs: DayLog[], copy: { endOfDaySay: string }): Suggestion[] {
  const active = activeLogs(logs);
  if (active.length < 3) return [];
  return [morning(active), ...followups(active), endOfDay(active, copy.endOfDaySay), meeting(active), night(active)]
    .filter((suggestion): suggestion is Suggestion => suggestion !== null)
    .sort((a, b) => b.score - a.score);
}

function timeOf(trigger: Trigger) {
  if (trigger.kind !== "time") return null;
  const [hours, minutes] = trigger.time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function titleOf(suggestion: Suggestion, titles: { morning: string; followup: (from: string, to: string) => string; endOfDay: string; night: string; meeting: string }) {
  return suggestion.kind === "followup" ? titles.followup(appName(suggestion.apps[0]), appName(suggestion.apps[1])) : titles[suggestion.kind];
}

export function nextToAnnounce(suggestions: Suggestion[], announced: string[]) {
  return suggestions.find((suggestion) => suggestion.score >= 0.75 && !announced.includes(suggestion.id)) ?? null;
}

export function covered(suggestion: Suggestion, rules: Rule[]) {
  return rules.some((rule) => {
    if (rule.trigger.kind !== suggestion.trigger.kind) return false;
    if (suggestion.trigger.kind === "app" && rule.trigger.kind === "app" && fold(rule.trigger.app) !== fold(suggestion.trigger.app)) return false;
    const a = timeOf(rule.trigger);
    const b = timeOf(suggestion.trigger);
    if (a !== null && b !== null && Math.abs(a - b) > 45) return false;
    const kinds = new Set(actionsOf(rule).map((action) => action.kind));
    return suggestion.actions.some((action) => kinds.has(action.kind));
  });
}

export function parseLearnState(raw: string | null): LearnState {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === "accepted" || value === "dismissed")) as LearnState;
  } catch {
    return {};
  }
}

export function pending(suggestions: Suggestion[], rules: Rule[], state: LearnState) {
  return suggestions.filter((suggestion) => !state[suggestion.id] && !covered(suggestion, rules));
}

export function recentDays(now: Date, count = LEARN_DAYS) {
  const days: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    days.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
  }
  return days;
}
