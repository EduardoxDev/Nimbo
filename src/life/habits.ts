export type Habits = Record<string, Record<string, string[]>>;

const KEEP_DATES = 8;
const MIN_DAYS = 3;
const IGNORED = /^(explorer|searchhost|shellexperiencehost|startmenuexperiencehost|lockapp|applicationframehost|nimbo|textinputhost|systemsettings)\.exe$/i;

export function bucketOf(date: Date) {
  return `${date.getDay()}-${date.getHours()}`;
}

function dayOf(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function appName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function parseHabits(raw: string | null): Habits {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Habits) : {};
  } catch {
    return {};
  }
}

export function recordHabit(habits: Habits, path: string, date: Date): Habits {
  if (!path || IGNORED.test(appName(path))) return habits;
  const bucket = bucketOf(date);
  const day = dayOf(date);
  const apps = { ...(habits[bucket] ?? {}) };
  const days = apps[path] ?? [];
  if (days.includes(day)) return habits;
  apps[path] = [...days, day].slice(-KEEP_DATES);
  return { ...habits, [bucket]: apps };
}

export function suggestHabit(habits: Habits, date: Date, currentPath: string): string | null {
  const today = dayOf(date);
  const apps = habits[bucketOf(date)] ?? {};
  const best = Object.entries(apps)
    .map(([path, days]) => ({ path, days: days.filter((day) => day !== today).length }))
    .filter((entry) => entry.days >= MIN_DAYS && entry.path !== currentPath)
    .sort((a, b) => b.days - a.days)[0];
  return best?.path ?? null;
}

export function prettyApp(path: string) {
  const name = appName(path).replace(/\.exe$/i, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
