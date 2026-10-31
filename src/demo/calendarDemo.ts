import { isTauri } from "@tauri-apps/api/core";
import type { CalendarEvent } from "../calendar/calendar";

export const CALENDAR_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "calendar";

const at = (dayOffset: number, hours: number, minutes = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
};

const now = Date.now();

export const DEMO_EVENTS: CalendarEvent[] = [
  { id: "d1", title: "Daily do time", location: null, start: now - 10 * 60_000, end: now + 5 * 60_000, allDay: false, calendar: "Trabalho" },
  { id: "d2", title: "Revisão do Nimbo", location: "Google Meet", start: now + 8 * 60_000, end: now + 38 * 60_000, allDay: false, calendar: "Trabalho" },
  { id: "d3", title: "Dentista", location: "Rua das Flores, 120", start: at(0, 18, 30), end: at(0, 19, 30), allDay: false, calendar: "Pessoal" },
  { id: "d4", title: "Feriado", location: null, start: at(1, 0), end: at(2, 0), allDay: true, calendar: "Feriados" },
  { id: "d5", title: "Almoço com a família", location: null, start: at(1, 12, 30), end: at(1, 14), allDay: false, calendar: "Pessoal" },
  { id: "d6", title: "Entrega da v0.3", location: null, start: at(3, 10), end: at(3, 11), allDay: false, calendar: "Trabalho" },
];
