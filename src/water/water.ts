/** One day of drinking, saved per calendar day. */
export type WaterDay = {
  date: string;
  cups: number;
  lastDrinkAt: number | null;
  /** A dismissed reminder stays quiet until this time. */
  snoozedUntil: number | null;
};

export type WaterSettings = {
  goalMl: number;
  cupMl: number;
  reminderMinutes: number;
};

/** Reminders only during waking hours. */
const QUIET_BEFORE_HOUR = 7;
const QUIET_FROM_HOUR = 23;
const SNOOZE_MS = 15 * 60_000;

export function dayKey(time: number) {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function freshDay(now: number): WaterDay {
  return { date: dayKey(now), cups: 0, lastDrinkAt: null, snoozedUntil: null };
}

/** A new calendar day starts from zero. */
export function currentDay(day: WaterDay, now: number): WaterDay {
  return day.date === dayKey(now) ? day : freshDay(now);
}

export function drink(day: WaterDay, now: number): WaterDay {
  const today = currentDay(day, now);
  return { ...today, cups: today.cups + 1, lastDrinkAt: now, snoozedUntil: null };
}

export function undoDrink(day: WaterDay, now: number): WaterDay {
  const today = currentDay(day, now);
  return { ...today, cups: Math.max(0, today.cups - 1) };
}

export function snooze(day: WaterDay, now: number): WaterDay {
  return { ...currentDay(day, now), snoozedUntil: now + SNOOZE_MS };
}

export function drankMl(day: WaterDay, settings: WaterSettings) {
  return day.cups * settings.cupMl;
}

export function progressOf(day: WaterDay, settings: WaterSettings) {
  return settings.goalMl > 0 ? Math.min(1, drankMl(day, settings) / settings.goalMl) : 0;
}

/**
 * When the next reminder is due, or null when reminders are off, the goal is
 * met or it is night. `startedAt` stands in for the last drink early in the day.
 */
export function nextReminderAt(day: WaterDay, settings: WaterSettings, startedAt: number) {
  if (settings.reminderMinutes <= 0 || progressOf(day, settings) >= 1) return null;
  // A snoozed reminder comes back after the snooze; drinking clears the snooze.
  const due = day.snoozedUntil ?? (day.lastDrinkAt ?? startedAt) + settings.reminderMinutes * 60_000;
  const hour = new Date(due).getHours();
  if (hour < QUIET_BEFORE_HOUR) {
    const morning = new Date(due);
    morning.setHours(QUIET_BEFORE_HOUR, 0, 0, 0);
    return morning.getTime();
  }
  if (hour >= QUIET_FROM_HOUR) return null;
  return due;
}

export function isReminderDue(day: WaterDay, settings: WaterSettings, now: number, startedAt: number) {
  const due = nextReminderAt(day, settings, startedAt);
  return due !== null && now >= due;
}

export function parseWaterDay(raw: string | null, now: number): WaterDay {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<WaterDay>) : null;
    if (value && typeof value.date === "string" && typeof value.cups === "number") {
      return currentDay(
        {
          date: value.date,
          cups: Math.max(0, Math.floor(value.cups)),
          lastDrinkAt: typeof value.lastDrinkAt === "number" ? value.lastDrinkAt : null,
          snoozedUntil: typeof value.snoozedUntil === "number" ? value.snoozedUntil : null,
        },
        now,
      );
    }
  } catch {
    // A damaged value starts the day over.
  }
  return freshDay(now);
}
