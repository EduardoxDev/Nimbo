/**
 * Nimbo Retrospective: the last 30 days in a few story cards, from what the
 * Nimbo already keeps on this PC (focus, tasks, water, time per app, music).
 */
import { categoryOf, labelOf, type Segment } from "../day/activity";
import type { StatsHistory } from "../stats/stats";
import type { WaterHistory } from "../water/water";

export const RETRO_DAYS = 30;
export const MUSIC_LOG_KEY = "nimbo-music-log";
export const RETRO_SEEN_KEY = "nimbo-retro-seen";

/** Plays per song ("artist — title"), per day. */
export type MusicLog = Record<string, Record<string, number>>;
export type Archetype = "nightOwl" | "focused" | "social" | "explorer" | "maker";

export type Retro = {
  from: string;
  to: string;
  focusSessions: number;
  focusMinutes: number;
  bestFocusDay: { date: string; sessions: number } | null;
  todos: number;
  agents: number;
  activeMs: number;
  topApps: { label: string; ms: number }[];
  /** The latest the PC was in use, counted past midnight (25:30 = 1:30 am). */
  latestNight: { date: string; minutes: number } | null;
  waterDaysMet: number;
  topSong: { name: string; plays: number } | null;
  songs: number;
  archetype: Archetype;
};

export function dayKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function lastDayKeys(now: number, count = RETRO_DAYS) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (count - 1 - index));
    return dayKey(date);
  });
}

/** Adds one play of a song to today's log, keeping 60 days. */
export function logPlay(log: MusicLog, song: string, now: number): MusicLog {
  const today = dayKey(new Date(now));
  const day = log[today] ?? {};
  const next: MusicLog = { ...log, [today]: { ...day, [song]: (day[song] ?? 0) + 1 } };
  const keep = Object.keys(next).sort().slice(-60);
  return Object.fromEntries(keep.map((key) => [key, next[key]]));
}

/** Minutes after the evening started: 22:00 → 1320, 1:30 am → 1530. Early mornings count as the night before. */
function nightMinutes(at: number) {
  const date = new Date(at);
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes < 6 * 60 ? minutes + 24 * 60 : minutes;
}

export function buildRetro(input: {
  now: number;
  stats: StatsHistory;
  water: WaterHistory;
  waterGoalMl: number;
  focusMinutes: number;
  activity: Record<string, Segment[]>;
  music: MusicLog;
}): Retro {
  const days = lastDayKeys(input.now);
  let focusSessions = 0;
  let todos = 0;
  let agents = 0;
  let bestFocusDay: Retro["bestFocusDay"] = null;
  for (const day of days) {
    const stats = input.stats[day];
    if (!stats) continue;
    focusSessions += stats.focus;
    todos += stats.todos;
    agents += stats.agents;
    if (stats.focus > 0 && (!bestFocusDay || stats.focus > bestFocusDay.sessions)) bestFocusDay = { date: day, sessions: stats.focus };
  }

  const appTime = new Map<string, number>();
  const byCategory = { work: 0, communication: 0, distraction: 0, other: 0 };
  let activeMs = 0;
  let latestNight: Retro["latestNight"] = null;
  let lateNights = 0;
  for (const day of days) {
    const segments = input.activity[day] ?? [];
    let dayLatest = 0;
    for (const segment of segments) {
      const ms = Math.max(0, segment.end - segment.start);
      activeMs += ms;
      const label = labelOf(segment);
      appTime.set(label, (appTime.get(label) ?? 0) + ms);
      byCategory[categoryOf(segment)] += ms;
      // Only the evening counts: a morning start says nothing about late nights.
      const minutes = nightMinutes(segment.end);
      if (minutes >= 20 * 60) dayLatest = Math.max(dayLatest, minutes);
    }
    if (dayLatest >= 24 * 60) lateNights += 1;
    if (dayLatest > 0 && (!latestNight || dayLatest > latestNight.minutes)) latestNight = { date: day, minutes: dayLatest };
  }
  const topApps = [...appTime.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, ms]) => ({ label, ms }));

  const plays = new Map<string, number>();
  for (const day of days) {
    for (const [song, count] of Object.entries(input.music[day] ?? {})) plays.set(song, (plays.get(song) ?? 0) + count);
  }
  const top = [...plays.entries()].sort((a, b) => b[1] - a[1])[0];

  const waterDaysMet = input.waterGoalMl > 0 ? days.filter((day) => (input.water[day] ?? 0) >= input.waterGoalMl).length : 0;

  return {
    from: days[0],
    to: days[days.length - 1],
    focusSessions,
    focusMinutes: focusSessions * input.focusMinutes,
    bestFocusDay,
    todos,
    agents,
    activeMs,
    topApps,
    latestNight,
    waterDaysMet,
    topSong: top ? { name: top[0], plays: top[1] } : null,
    songs: plays.size,
    archetype: archetypeOf({ byCategory, activeMs, lateNights, focusSessions }),
  };
}

/** Who you were this month, from where the time went. */
export function archetypeOf(input: { byCategory: Record<"work" | "communication" | "distraction" | "other", number>; activeMs: number; lateNights: number; focusSessions: number }): Archetype {
  if (input.lateNights >= 6) return "nightOwl";
  const total = Math.max(1, input.activeMs);
  if (input.byCategory.work / total >= 0.5 || input.focusSessions >= 20) return "focused";
  if (input.byCategory.communication / total >= 0.3) return "social";
  if (input.byCategory.distraction / total >= 0.3) return "explorer";
  return "maker";
}

/** "25:30" → "1:30". */
export function clockOfNight(minutes: number) {
  const value = minutes % (24 * 60);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Shows the retrospective nudge on the first days of a month, once. */
export function retroDue(now: number, lastSeenMonth: string | null) {
  const date = new Date(now);
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return date.getDate() <= 3 && lastSeenMonth !== month ? month : null;
}
