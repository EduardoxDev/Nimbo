import { dayKey } from "../water/water";

export type StatKind = "focus" | "todos" | "agents";
export type DayStats = Record<StatKind, number>;
export type StatsHistory = Record<string, DayStats>;
export type Evolution = { level: number; points: number; nextAt: number | null };

const KEEP_DAYS = 120;
const LEVELS = [0, 10, 30, 60, 100, 160];
const POINTS: Record<StatKind | "water", number> = { water: 3, focus: 2, todos: 1, agents: 1 };

export const EMPTY_DAY: DayStats = { focus: 0, todos: 0, agents: 0 };

export function parseStats(raw: string | null): StatsHistory {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const history: StatsHistory = {};
    for (const [key, value] of Object.entries(parsed as Record<string, Partial<DayStats>>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== "object") continue;
      history[key] = {
        focus: Math.max(0, Number(value.focus) || 0),
        todos: Math.max(0, Number(value.todos) || 0),
        agents: Math.max(0, Number(value.agents) || 0),
      };
    }
    return history;
  } catch {
    return {};
  }
}

export function addStat(history: StatsHistory, kind: StatKind, now: number): StatsHistory {
  const key = dayKey(now);
  const day = history[key] ?? EMPTY_DAY;
  const next: StatsHistory = { ...history, [key]: { ...day, [kind]: day[kind] + 1 } };
  const keys = Object.keys(next).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete next[old];
  return next;
}

export function statsDays(history: StatsHistory, now: number, count = 7) {
  const today = dayKey(now);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (count - 1 - index));
    const key = dayKey(date.getTime());
    return { date: key, stats: history[key] ?? EMPTY_DAY, isToday: key === today };
  });
}

export function evolutionOf(history: StatsHistory, waterDaysMet: number): Evolution {
  let points = waterDaysMet * POINTS.water;
  for (const day of Object.values(history)) {
    points += day.focus * POINTS.focus + day.todos * POINTS.todos + day.agents * POINTS.agents;
  }
  const reached = LEVELS.filter((threshold) => points >= threshold).length;
  return { level: reached, points, nextAt: LEVELS[reached] ?? null };
}
