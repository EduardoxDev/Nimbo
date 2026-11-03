import { distractionOf } from "../life/distraction";
import type { StatsHistory } from "../stats/stats";

export const DEFAULT_BLOCKLIST = ["YouTube", "Instagram", "TikTok", "X", "Netflix", "Reddit", "Facebook", "Twitch", "Steam"];
export const FOCUS_LOG_KEY = "nimbo-focus-log";
export const ALLOW_MS = 5 * 60_000;
const KEEP_DAYS = 60;

export type FocusLog = Record<string, Record<string, number>>;
export type WeekReport = { sessions: number; minutes: number; bestDay: string | null; attempts: number; top: { name: string; count: number } | null };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function cleanBlocklist(list: unknown): string[] {
  if (!Array.isArray(list)) return DEFAULT_BLOCKLIST;
  const seen = new Set<string>();
  return list
    .map((item) => String(item ?? "").trim().slice(0, 40))
    .filter((item) => item && !seen.has(fold(item)) && seen.add(fold(item)))
    .slice(0, 40);
}

export function blockedName(title: string, app: string, list: string[]): string | null {
  const known = distractionOf(title, app);
  if (known && list.some((item) => fold(item) === fold(known))) return known;
  const haystack = fold(`${title} ${app.replace(/\.exe$/i, "")}`);
  const custom = list.find((item) => {
    const needle = fold(item).replace(/\s+/g, "");
    return needle.length >= 3 && haystack.replace(/\s+/g, "").includes(needle);
  });
  return custom ?? null;
}

export function allowed(allowances: Record<string, number>, name: string, now: number) {
  return (allowances[name] ?? 0) > now;
}

function dayKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseFocusLog(raw: string | null): FocusLog {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const log: FocusLog = {};
    for (const [day, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !value || typeof value !== "object") continue;
      log[day] = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, count]) => Number.isFinite(Number(count))).map(([name, count]) => [name, Math.max(0, Math.round(Number(count)))]));
    }
    return log;
  } catch {
    return {};
  }
}

export function recordAttempt(log: FocusLog, name: string, at: number): FocusLog {
  const key = dayKey(at);
  const day = log[key] ?? {};
  const next: FocusLog = { ...log, [key]: { ...day, [name]: (day[name] ?? 0) + 1 } };
  const keys = Object.keys(next).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete next[old];
  return next;
}

export function lastWeek(now: Date) {
  const days: string[] = [];
  for (let offset = 7; offset >= 1; offset--) days.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime()));
  return days;
}

export function weekReport(stats: StatsHistory, log: FocusLog, days: string[], focusMinutes: number): WeekReport {
  let sessions = 0;
  let best: { day: string; count: number } | null = null;
  const totals = new Map<string, number>();
  for (const day of days) {
    const count = stats[day]?.focus ?? 0;
    sessions += count;
    if (count > 0 && (!best || count > best.count)) best = { day, count };
    for (const [name, attempts] of Object.entries(log[day] ?? {})) totals.set(name, (totals.get(name) ?? 0) + attempts);
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    sessions,
    minutes: sessions * focusMinutes,
    bestDay: best?.day ?? null,
    attempts: ranked.reduce((sum, [, count]) => sum + count, 0),
    top: ranked[0] ? { name: ranked[0][0], count: ranked[0][1] } : null,
  };
}

export function weekKey(now: Date) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return dayKey(monday.getTime());
}
