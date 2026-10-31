import assert from "node:assert/strict";
import test from "node:test";
import { groupByDay, minutesUntil, upcomingReminder } from "../src/calendar/calendar.ts";

const base = new Date(2026, 9, 30, 9, 0).getTime();
const event = (id, startMin, lengthMin, allDay = false) => ({
  id,
  title: id,
  location: null,
  start: base + startMin * 60_000,
  end: base + (startMin + lengthMin) * 60_000,
  allDay,
  calendar: "c",
});

test("reminder fires inside the window and respects dismissal", () => {
  const events = [event("soon", 8, 30), event("later", 120, 30)];
  assert.equal(upcomingReminder(events, base, 10, new Set())?.id, "soon");
  assert.equal(upcomingReminder(events, base, 5, new Set()), null);
  assert.equal(upcomingReminder(events, base, 10, new Set(["soon"])), null);
  assert.equal(upcomingReminder(events, base, 0, new Set()), null);
  assert.equal(minutesUntil(events[0], base), 8);
});

test("all-day events never trigger reminders", () => {
  assert.equal(upcomingReminder([event("day", 5, 1440, true)], base, 10, new Set()), null);
});

test("events are grouped by day and finished ones are hidden", () => {
  const groups = groupByDay([event("done", -120, 30), event("today", 60, 30), event("tomorrow", 24 * 60, 30)], base);
  assert.deepEqual(groups.map((group) => group.offset), [0, 1]);
  assert.deepEqual(groups[0].events.map((item) => item.id), ["today"]);
});

test("the ongoing event is the timed one happening now", async () => {
  const { ongoingEvent } = await import("../src/calendar/calendar.ts");
  const base = { location: null, calendar: "c", allDay: false };
  const events = [
    { ...base, id: "all", title: "Feriado", start: 0, end: 10_000, allDay: true },
    { ...base, id: "a", title: "Daily", start: 1_000, end: 2_000 },
  ];
  assert.equal(ongoingEvent(events, 1_500)?.id, "a");
  assert.equal(ongoingEvent(events, 2_000), null);
  assert.equal(ongoingEvent(events, 500), null);
});
