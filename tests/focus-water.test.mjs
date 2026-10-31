import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceFocus,
  initialFocusState,
  parseFocusState,
  pauseFocus,
  remainingOf,
  startFocus,
  syncIdleLength,
} from "../src/focus/pomodoro.ts";
import { drink, isReminderDue, nextReminderAt, parseWaterDay, progressOf, snooze, undoDrink } from "../src/water/water.ts";

const durations = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, rounds: 2 };
const MIN = 60_000;

test("focus timer starts, pauses and keeps the time left", () => {
  let state = initialFocusState(durations);
  assert.equal(state.remainingMs, 25 * MIN);
  state = startFocus(state, 1_000);
  assert.equal(remainingOf(state, 1_000 + 10 * MIN), 15 * MIN);
  state = pauseFocus(state, 1_000 + 10 * MIN);
  assert.equal(state.status, "paused");
  assert.equal(remainingOf(state, 9_999_999), 15 * MIN);
  state = startFocus(state, 50 * MIN);
  assert.equal(state.endsAt, 65 * MIN);
});

test("phases cycle focus → short → focus → long → focus", () => {
  let state = initialFocusState(durations);
  state = advanceFocus(state, durations, 0, false);
  assert.deepEqual([state.phase, state.completed, state.status, state.remainingMs], ["short", 1, "idle", 5 * MIN]);
  state = advanceFocus(state, durations, 0, false);
  assert.equal(state.phase, "focus");
  state = advanceFocus(state, durations, 0, true);
  assert.deepEqual([state.phase, state.completed, state.status, state.endsAt], ["long", 2, "running", 15 * MIN]);
  state = advanceFocus(state, durations, 0, false);
  assert.deepEqual([state.phase, state.completed], ["focus", 0]);
});

test("idle timers follow new durations and bad saves start over", () => {
  const idle = initialFocusState(durations);
  assert.equal(syncIdleLength(idle, { ...durations, focusMinutes: 50 }).remainingMs, 50 * MIN);
  const running = startFocus(idle, 0);
  assert.equal(syncIdleLength(running, { ...durations, focusMinutes: 50 }), running);
  assert.equal(parseFocusState("{bad", durations).status, "idle");
  assert.equal(parseFocusState(JSON.stringify({ phase: "nap", status: "idle", remainingMs: 1, completed: 0 }), durations).phase, "focus");
});

test("water counts cups per day and reminds on schedule", () => {
  const settings = { goalMl: 1000, cupMl: 250, reminderMinutes: 60 };
  const noon = new Date(2026, 9, 30, 12, 0).getTime();
  let day = parseWaterDay(null, noon);
  assert.equal(progressOf(day, settings), 0);
  assert.equal(isReminderDue(day, settings, noon + 59 * MIN, noon), false);
  assert.equal(isReminderDue(day, settings, noon + 60 * MIN, noon), true);
  day = drink(day, noon + 60 * MIN);
  assert.equal(day.cups, 1);
  assert.equal(isReminderDue(day, settings, noon + 90 * MIN, noon), false);
  day = snooze(day, noon + 120 * MIN);
  assert.equal(isReminderDue(day, settings, noon + 130 * MIN, noon), false);
  assert.equal(isReminderDue(day, settings, noon + 136 * MIN, noon), true);
  day = undoDrink(undoDrink(day, noon), noon);
  assert.equal(day.cups, 0);
  const tomorrow = new Date(2026, 9, 31, 9, 0).getTime();
  assert.equal(drink(drink(day, noon), tomorrow).cups, 1);
});

test("no reminders at night, when off, or once the goal is met", () => {
  const settings = { goalMl: 500, cupMl: 250, reminderMinutes: 60 };
  const late = new Date(2026, 9, 30, 22, 30).getTime();
  const day = parseWaterDay(null, late);
  assert.equal(nextReminderAt(day, settings, late), null);
  assert.equal(nextReminderAt(day, { ...settings, reminderMinutes: 0 }, late - 120 * MIN), null);
  const full = drink(drink(day, late), late);
  assert.equal(nextReminderAt(full, settings, late), null);
});

test("water history keeps two weeks and marks met goals", async () => {
  const { recordHistory, lastDays, parseWaterHistory } = await import("../src/water/water.ts");
  let history = {};
  for (let day = 1; day <= 20; day += 1) history = recordHistory(history, `2026-10-${String(day).padStart(2, "0")}`, day * 100);
  assert.equal(Object.keys(history).length, 14);
  const now = new Date(2026, 9, 20, 12).getTime();
  const week = lastDays(history, now, 1800);
  assert.equal(week.length, 7);
  assert.equal(week[6].isToday, true);
  assert.equal(week[6].met, true);
  assert.equal(week[0].met, false);
  assert.deepEqual(parseWaterHistory('{"2026-10-01": 500, "bad": 3, "2026-10-02": -1}'), { "2026-10-01": 500 });
});
