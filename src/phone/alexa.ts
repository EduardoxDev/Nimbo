export type AgendaItem = { title: string; time: string; allDay: boolean };

export function validPin(pin: string) {
  return /^\d{4,6}$/.test(pin);
}

export function validPinHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export async function pinHashOf(pin: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nimbo-pin:${pin}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function agendaOfToday(
  events: { title: string; start: number; end: number; allDay: boolean }[],
  now: number,
  formatTime: (time: number) => string,
): AgendaItem[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return events
    .filter((event) => event.start < end.getTime() && event.end > Math.max(now, start.getTime()))
    .sort((a, b) => a.start - b.start)
    .slice(0, 6)
    .map((event) => ({ title: event.title, time: event.allDay ? "" : formatTime(event.start), allDay: event.allDay }));
}
