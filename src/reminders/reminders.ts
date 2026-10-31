export type Reminder = { id: string; text: string; at: number };

const MINUTE = 60_000;
const PREFIXES = [/^(?:me\s+)?lembr(?:a|e|ar)(?:\s+(?:me|de|que))*\s+(.+)$/i, /^remind\s+me\s+(?:to\s+|about\s+|of\s+)?(.+)$/i];
const RELATIVE = /\s+(?:em|daqui\s+a|in)\s+(\d{1,4})\s*(minutos?|minutes?|mins?|m|horas?|hours?|h)\s*$/i;
const ABSOLUTE = /\s+(?:[àa]s?|at)\s+(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?)?\s*(am|pm|h)?\s*$/i;
const TOMORROW = /(?:^|\s)(?:amanh[ãa]|tomorrow)(?=\s|$)/i;
const CHINESE = /^(\d{1,4})\s*(分钟|小时)后提醒我(.+)$/;

function unit(word: string) {
  return /^h/i.test(word) ? 60 * MINUTE : MINUTE;
}

function tidy(text: string) {
  return text.replace(/^(?:de|do|da|to|about)\s+/i, "").replace(/[.!]+$/, "").trim();
}

export function parseReminder(input: string, now: number): Omit<Reminder, "id"> | null {
  const raw = input.trim();
  const chinese = CHINESE.exec(raw);
  if (chinese) {
    const text = chinese[3].trim();
    return text ? { text, at: now + Number(chinese[1]) * (chinese[2] === "小时" ? 60 * MINUTE : MINUTE) } : null;
  }
  const body = PREFIXES.map((pattern) => pattern.exec(raw)?.[1]).find(Boolean);
  if (!body) return null;
  const tomorrow = TOMORROW.test(body);
  const rest = body.replace(TOMORROW, " ").trim();
  const relative = RELATIVE.exec(` ${rest}`);
  if (relative) {
    const amount = Number(relative[1]);
    const text = tidy(` ${rest}`.slice(0, relative.index));
    return amount > 0 && text ? { text, at: now + amount * unit(relative[2]) } : null;
  }
  const absolute = ABSOLUTE.exec(` ${rest}`);
  if (!absolute) return null;
  let hour = Number(absolute[1]);
  const minute = Number(absolute[2] ?? 0);
  const suffix = absolute[3]?.toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const text = tidy(` ${rest}`.slice(0, absolute.index));
  if (!text) return null;
  const date = new Date(now);
  date.setHours(hour, minute, 0, 0);
  if (tomorrow || date.getTime() <= now) date.setDate(date.getDate() + 1);
  return { text, at: date.getTime() };
}

export function parseReminders(raw: string | null): Reminder[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Reminder => Boolean(item) && typeof item.id === "string" && typeof item.text === "string" && Number.isFinite(item.at))
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function dueReminder(reminders: Reminder[], now: number) {
  return [...reminders].sort((a, b) => a.at - b.at).find((reminder) => reminder.at <= now) ?? null;
}
