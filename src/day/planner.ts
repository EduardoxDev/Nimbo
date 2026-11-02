/**
 * Day planner: fits the open tasks into the free time between now and the end
 * of the day, around calendar events, with short breaks.
 */

export type PlanEvent = { title: string; start: number; end: number };
export type PlanItem = { kind: "task" | "event" | "break"; title: string; start: number; end: number };
export type Plan = { items: PlanItem[]; leftover: string[] };

const MINUTE = 60_000;
const DEFAULT_MINUTES = 45;
const BREAK_MINUTES = 10;
const MIN_SLOT = 15;

/** "Relatório (30m)", "ligar pro João 15 min", "estudar 1h30" → minutes; otherwise 45. */
export function estimateMinutes(title: string) {
  const hours = /(\d+)\s*h(?:oras?)?\s*(\d+)?\b/i.exec(title);
  if (hours) return Math.min(240, Number(hours[1]) * 60 + Number(hours[2] ?? 0));
  const mins = /(\d+)\s*(?:m|min|minutos?)\b/i.exec(title);
  if (mins) return Math.min(240, Math.max(5, Number(mins[1])));
  return DEFAULT_MINUTES;
}

function roundUp(time: number, step = 5 * MINUTE) {
  return Math.ceil(time / step) * step;
}

export function planDay(tasks: string[], events: PlanEvent[], now: number, endHour = 18): Plan {
  const end = new Date(now);
  end.setHours(endHour, 0, 0, 0);
  const dayEnd = end.getTime();
  const todays = events.filter((event) => event.end > now && event.start < dayEnd).sort((a, b) => a.start - b.start);

  // Free stretches between events.
  const free: { start: number; end: number }[] = [];
  let cursor = roundUp(now);
  for (const event of todays) {
    if (event.start - cursor >= MIN_SLOT * MINUTE) free.push({ start: cursor, end: event.start });
    cursor = Math.max(cursor, roundUp(event.end));
  }
  if (dayEnd - cursor >= MIN_SLOT * MINUTE) free.push({ start: cursor, end: dayEnd });

  const items: PlanItem[] = todays.map((event) => ({ kind: "event", title: event.title, start: Math.max(event.start, now), end: event.end }));
  const leftover: string[] = [];
  let slot = 0;
  let at = free[0]?.start ?? dayEnd;
  for (const title of tasks) {
    const length = estimateMinutes(title) * MINUTE;
    while (slot < free.length && free[slot].end - at < Math.min(length, MIN_SLOT * MINUTE)) {
      slot += 1;
      at = free[slot]?.start ?? dayEnd;
    }
    if (slot >= free.length) {
      leftover.push(title);
      continue;
    }
    // A long task may be cut to what fits before the next event.
    const finish = Math.min(at + length, free[slot].end);
    items.push({ kind: "task", title, start: at, end: finish });
    at = finish;
    if (free[slot].end - at >= (BREAK_MINUTES + MIN_SLOT) * MINUTE) {
      items.push({ kind: "break", title: "", start: at, end: at + BREAK_MINUTES * MINUTE });
      at += BREAK_MINUTES * MINUTE;
    }
  }
  // A trailing break after the last task is noise.
  items.sort((a, b) => a.start - b.start);
  while (items[items.length - 1]?.kind === "break") items.pop();
  return { items, leftover };
}
