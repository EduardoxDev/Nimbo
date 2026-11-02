/**
 * One-click routines: "start the day" and "end the day" run a short list of
 * steps (open apps, focus, air conditioner, music, a spoken briefing).
 */

export type RoutineKind = "start" | "end";
export type RoutineApp = { name: string; id: string };
export type Routine = {
  apps: RoutineApp[];
  focus: "keep" | "start" | "stop";
  ac: "keep" | "on" | "off";
  acTemperature: number;
  music: "keep" | "play" | "pause";
  /** What to play when music is "play"; empty resumes what was playing. */
  musicQuery: string;
  speak: boolean;
  /** "HH:MM" when the island should offer the routine, or "" for never. */
  time: string;
};
export type Routines = Record<RoutineKind, Routine>;

export const ROUTINE_KINDS: RoutineKind[] = ["start", "end"];
export const MAX_ROUTINE_APPS = 6;

export const DEFAULT_ROUTINES: Routines = {
  start: { apps: [], focus: "keep", ac: "keep", acTemperature: 23, music: "keep", musicQuery: "", speak: true, time: "" },
  end: { apps: [], focus: "stop", ac: "keep", acTemperature: 23, music: "pause", musicQuery: "", speak: true, time: "" },
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function normalizeRoutine(value: unknown, fallback: Routine): Routine {
  const raw = value && typeof value === "object" ? (value as Partial<Record<keyof Routine, unknown>>) : {};
  const apps = Array.isArray(raw.apps)
    ? raw.apps
        .filter((app): app is RoutineApp => !!app && typeof app.name === "string" && typeof app.id === "string" && !!app.id)
        .map((app) => ({ name: app.name.slice(0, 80), id: app.id.slice(0, 300) }))
        .filter((app, index, list) => list.findIndex((other) => other.id === app.id) === index)
        .slice(0, MAX_ROUTINE_APPS)
    : fallback.apps;
  const temperature = Number(raw.acTemperature);
  return {
    apps,
    focus: pick(raw.focus, ["keep", "start", "stop"] as const, fallback.focus),
    ac: pick(raw.ac, ["keep", "on", "off"] as const, fallback.ac),
    acTemperature: Number.isFinite(temperature) ? Math.min(30, Math.max(16, Math.round(temperature))) : fallback.acTemperature,
    music: pick(raw.music, ["keep", "play", "pause"] as const, fallback.music),
    musicQuery: typeof raw.musicQuery === "string" ? raw.musicQuery.slice(0, 120) : fallback.musicQuery,
    speak: typeof raw.speak === "boolean" ? raw.speak : fallback.speak,
    time: typeof raw.time === "string" && (raw.time === "" || TIME_PATTERN.test(raw.time)) ? raw.time : fallback.time,
  };
}

export function normalizeRoutines(value: unknown): Routines {
  const raw = value && typeof value === "object" ? (value as Partial<Record<RoutineKind, unknown>>) : {};
  return { start: normalizeRoutine(raw.start, DEFAULT_ROUTINES.start), end: normalizeRoutine(raw.end, DEFAULT_ROUTINES.end) };
}

const START = /^(?:come[cç]a(?:r)?\s+o\s+dia|bom\s+dia|start\s+(?:my|the)\s+day|good\s+morning|开始(?:新的)?一天|早上好)[.!]*$/i;
const END = /^(?:encerra(?:r)?\s+o\s+dia|termina(?:r)?\s+o\s+dia|fim\s+do\s+dia|boa\s+noite|end\s+(?:my|the)\s+day|good\s+night|结束(?:这)?一天|晚安)[.!]*$/i;

/** "começar o dia" / "end my day" typed in the launcher or said to the assistant. */
export function routineOf(query: string): RoutineKind | null {
  const text = query.trim();
  if (START.test(text)) return "start";
  if (END.test(text)) return "end";
  return null;
}

/** Whether a routine set for "HH:MM" is due at this minute. */
export function routineDue(routine: Routine, date: Date) {
  if (!routine.time) return false;
  const [hour, minute] = routine.time.split(":").map(Number);
  return date.getHours() === hour && date.getMinutes() === minute;
}
