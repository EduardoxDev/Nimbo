/**
 * Nimbo as a companion: a good-morning that knows your yesterday and your day, and the
 * things you told it ("lembra que amanhã tenho entrevista"): it wishes you luck on the day
 * and asks how it went the day after. Everything stays on this PC (localStorage).
 */

import { dayKey } from "../water/water";
import type { StatsHistory } from "../stats/stats";

export type CompanionNote = { id: string; text: string; on: string; createdAt: number };
export type CompanionState = { notes: CompanionNote[]; lastGreetDay: string };

export const COMPANION_KEY = "nimbo-companion";
const MAX_NOTES = 30;
/** The good-morning waits for the morning. */
const GREET_FROM_HOUR = 5;

export const EMPTY_COMPANION: CompanionState = { notes: [], lastGreetDay: "" };

export function loadCompanion(storage: Pick<Storage, "getItem"> = window.localStorage): CompanionState {
  try {
    const value = JSON.parse(storage.getItem(COMPANION_KEY) ?? "null");
    if (!value || typeof value !== "object") return EMPTY_COMPANION;
    const notes = Array.isArray(value.notes)
      ? value.notes
          .filter((note: unknown): note is CompanionNote => {
            const item = note as Partial<CompanionNote> | null;
            return !!item && typeof item.text === "string" && typeof item.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(item.on));
          })
          .map((note: CompanionNote) => ({ id: note.id, text: note.text.slice(0, 120), on: note.on, createdAt: Number(note.createdAt) || 0 }))
      : [];
    return { notes: notes.slice(-MAX_NOTES), lastGreetDay: typeof value.lastGreetDay === "string" ? value.lastGreetDay : "" };
  } catch {
    return EMPTY_COMPANION;
  }
}

export function saveCompanion(state: CompanionState, storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(COMPANION_KEY, JSON.stringify(state));
  } catch {
    // Kept for this session only.
  }
}

const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function dayFrom(word: string, now: number): string | null {
  const lower = word.toLowerCase();
  const date = new Date(now);
  if (lower === "hoje" || lower === "today") return dayKey(now);
  if (lower === "amanhã" || lower === "amanha" || lower === "tomorrow") {
    date.setDate(date.getDate() + 1);
    return dayKey(date.getTime());
  }
  if (/^depois de amanh[ãa]$/.test(lower)) {
    date.setDate(date.getDate() + 2);
    return dayKey(date.getTime());
  }
  const weekday = WEEKDAYS[lower.replace(/-feira$/, "")];
  if (weekday === undefined) return null;
  const ahead = (weekday - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + ahead);
  return dayKey(date.getTime());
}

/**
 * "lembra que amanhã tenho uma entrevista", "não esquece: sexta tenho prova",
 * "remember that tomorrow I have a job interview" → what and which day.
 */
export function noteOf(text: string, now: number): { text: string; on: string } | null {
  const match = text
    .trim()
    .match(
      /^(?:ei,?\s+nimbo,?\s+)?(?:lembr[ae](?:-se)?|n[ãa]o esque[cç]a|n[ãa]o esquece|remember)(?:\s+(?:que|that))?[:,]?\s+(?:na\s+|no\s+|on\s+)?(hoje|amanh[ãa]|depois de amanh[ãa]|domingo|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)[,]?\s+(?:eu\s+|i\s+)?(?:tenho|vou ter|vou|tem|é|e|have|will have|got|am)\s+(.+?)[.!]*$/i,
    );
  if (!match) return null;
  const on = dayFrom(match[1], now);
  const what = match[2].trim().replace(/^(?:uma?|a|an|the|o|os|as)\s+/i, "");
  return on && what ? { text: what.slice(0, 120), on } : null;
}

export function addNote(state: CompanionState, note: { text: string; on: string }, now: number): CompanionState {
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { ...state, notes: [...state.notes, { id, text: note.text, on: note.on, createdAt: now }].slice(-MAX_NOTES) };
}

/** Consecutive days with at least one focus, counting back from today (or yesterday if today has none yet). */
export function focusStreak(history: StatsHistory, now: number) {
  const date = new Date(now);
  if (!(history[dayKey(now)]?.focus > 0)) date.setDate(date.getDate() - 1);
  let streak = 0;
  while (history[dayKey(date.getTime())]?.focus > 0) {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

export function shouldGreet(state: CompanionState, now: number) {
  return new Date(now).getHours() >= GREET_FROM_HOUR && state.lastGreetDay !== dayKey(now);
}

export type GreetingCopy = {
  hello: (hour: number) => string;
  today: (text: string) => string;
  howWas: (text: string) => string;
  yesterday: (focus: number, todos: number) => string;
  streak: (days: number) => string;
  agenda: (count: number, firstTime: string) => string;
};

/**
 * The good-morning: hello, then what matters most first (today's big thing, how yesterday's
 * went), then yesterday in numbers, the streak and the day ahead. Short: at most four parts.
 */
export function greetingOf(
  input: { now: number; history: StatsHistory; notes: CompanionNote[]; events: { start: number; allDay: boolean }[]; formatTime: (time: number) => string },
  copy: GreetingCopy,
) {
  const { now } = input;
  const today = dayKey(now);
  const before = new Date(now);
  before.setDate(before.getDate() - 1);
  const yesterdayKey = dayKey(before.getTime());
  const parts = [copy.hello(new Date(now).getHours())];
  for (const note of input.notes.filter((item) => item.on === today)) parts.push(copy.today(note.text));
  for (const note of input.notes.filter((item) => item.on === yesterdayKey)) parts.push(copy.howWas(note.text));
  const yesterday = input.history[yesterdayKey];
  if (yesterday && (yesterday.focus > 0 || yesterday.todos > 0)) parts.push(copy.yesterday(yesterday.focus, yesterday.todos));
  const streak = focusStreak(input.history, now);
  if (streak >= 3) parts.push(copy.streak(streak));
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const ahead = input.events.filter((event) => !event.allDay && event.start > now && event.start <= end.getTime()).sort((a, b) => a.start - b.start);
  if (ahead.length > 0) parts.push(copy.agenda(ahead.length, input.formatTime(ahead[0].start)));
  return parts.slice(0, 5).join(" ");
}

/** Notes older than two days have been wished and asked about: let them go. */
export function forgetOld(state: CompanionState, now: number): CompanionState {
  const limit = new Date(now);
  limit.setDate(limit.getDate() - 2);
  const oldest = dayKey(limit.getTime());
  return { ...state, notes: state.notes.filter((note) => note.on >= oldest) };
}
