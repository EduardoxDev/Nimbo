export type CalendarEvent = {
  id: string;
  title: string;
  location: string | null;
  /** The video call link (Meet, Teams, Zoom…), when the event has one. */
  link?: string | null;
  start: number;
  end: number;
  allDay: boolean;
  calendar: string;
};

export type CalendarSource = { name: string; host: string };

export const CALENDAR_CHANGED_KEY = "nimbo-calendar-changed";

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function upcomingReminder(
  events: CalendarEvent[],
  now: number,
  minutesBefore: number,
  dismissed: ReadonlySet<string>,
): CalendarEvent | null {
  if (minutesBefore <= 0) return null;
  const horizon = now + minutesBefore * 60_000;
  return (
    events.find(
      (event) => !event.allDay && !dismissed.has(event.id) && event.start > now - 60_000 && event.start <= horizon,
    ) ?? null
  );
}

export function ongoingEvent(events: CalendarEvent[], now: number): CalendarEvent | null {
  return events.find((event) => !event.allDay && event.start <= now && now < event.end) ?? null;
}

export function minutesUntil(event: CalendarEvent, now: number) {
  return Math.max(0, Math.round((event.start - now) / 60_000));
}

export function groupByDay(events: CalendarEvent[], now: number) {
  const groups = new Map<number, CalendarEvent[]>();
  for (const event of events) {
    if (event.end <= now) continue;
    const day = Math.max(startOfDay(event.start), startOfDay(now));
    const list = groups.get(day) ?? [];
    list.push(event);
    groups.set(day, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => ({
      day,
      offset: Math.round((day - startOfDay(now)) / DAY_MS),
      events: items.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start),
    }));
}
