/**
 * The PC's time machine (src-tauri/src/desk.rs): "volta meu PC para ontem às 15h",
 * "como estava o PC hoje 10h30", "volta 2 horas", "back to yesterday 3pm".
 */

const DAY_MS = 86_400_000;

function atClock(base: number, hour: number, minute: number) {
  const date = new Date(base);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/** The moment asked for (ms), or null when the text is not a time-machine request. */
export function timeRequestOf(text: string, now: number): number | null {
  const query = text.trim().toLowerCase();
  const asks = /^(?:volta(?:r)?|voltar|restaura(?:r)?|reabr(?:e|ir)|como estava|deixa (?:o pc|meu pc|tudo) como estava|back to|restore|go back)\b/.test(query);
  if (!asks) return null;
  // "volta 2 horas", "3 hours ago": a span back from now. "às 15 horas" stays a clock time.
  const ago = /(\d{1,2})\s*(?:horas?|hours?)\b/.exec(query);
  if (ago && !/(?:[àa]s|at)\s+\d/.test(query)) {
    const hours = Number(ago[1]);
    return hours > 0 && hours <= 72 ? now - hours * 3_600_000 : null;
  }
  const clock = /(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?|\s*(am|pm))/.exec(query);
  if (!clock) return null;
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  if (clock[3] === "pm" && hour < 12) hour += 12;
  if (clock[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const daysBack = /anteontem|day before yesterday/.test(query) ? 2 : /ontem|yesterday/.test(query) ? 1 : 0;
  const at = atClock(now - daysBack * DAY_MS, hour, minute);
  // "às 15h" without a day, said at 10h, means yesterday's 15h.
  return at > now ? at - DAY_MS : at;
}
