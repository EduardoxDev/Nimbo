import assert from "node:assert/strict";
import test from "node:test";
import { archetypeOf, buildRetro, clockOfNight, dayKey, lastDayKeys, logPlay, retroDue } from "../src/retro/retro.ts";

const now = new Date(2026, 10, 2, 15, 0).getTime();
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

test("the window is the last 30 days, ending today", () => {
  const keys = lastDayKeys(now);
  assert.equal(keys.length, 30);
  assert.equal(keys[29], "2026-11-02");
  assert.equal(keys[0], "2026-10-04");
});

test("songs are counted per day", () => {
  let log = logPlay({}, "Anitta — Envolver", now);
  log = logPlay(log, "Anitta — Envolver", now);
  assert.deepEqual(log, { "2026-11-02": { "Anitta — Envolver": 2 } });
});

test("the retrospective adds up focus, tasks, apps, water, music and the latest night", () => {
  const retro = buildRetro({
    now,
    stats: { "2026-11-01": { focus: 3, todos: 4, agents: 1 }, "2026-11-02": { focus: 5, todos: 2, agents: 0 }, "2025-01-01": { focus: 99, todos: 99, agents: 99 } },
    water: { "2026-11-01": 2500, "2026-11-02": 900 },
    waterGoalMl: 2000,
    focusMinutes: 25,
    activity: {
      "2026-11-01": [
        { app: "code.exe", title: "App.tsx", start: at(1, 9), end: at(1, 12) },
        { app: "chrome.exe", title: "YouTube - Google Chrome", start: at(1, 23), end: at(2, 1, 30) },
      ],
      "2026-11-02": [{ app: "code.exe", title: "x", start: at(2, 8), end: at(2, 9) }],
    },
    music: { "2026-11-01": { "A — x": 3, "B — y": 1 }, "2026-11-02": { "A — x": 2 } },
  });
  assert.equal(retro.focusSessions, 8);
  assert.equal(retro.focusMinutes, 200);
  assert.deepEqual(retro.bestFocusDay, { date: "2026-11-02", sessions: 5 });
  assert.equal(retro.todos, 6);
  assert.equal(retro.topApps[0].label, "VS Code");
  assert.equal(retro.topApps[0].ms, 4 * 3_600_000);
  assert.deepEqual(retro.latestNight, { date: "2026-11-01", minutes: 25 * 60 + 30 });
  assert.equal(clockOfNight(retro.latestNight.minutes), "1:30");
  assert.equal(retro.waterDaysMet, 1);
  assert.deepEqual(retro.topSong, { name: "A — x", plays: 5 });
  assert.equal(retro.songs, 2);
});

test("an empty month still makes a retrospective", () => {
  const retro = buildRetro({ now, stats: {}, water: {}, waterGoalMl: 2000, focusMinutes: 25, activity: {}, music: {} });
  assert.equal(retro.focusSessions, 0);
  assert.equal(retro.topSong, null);
  assert.equal(retro.latestNight, null);
  assert.equal(retro.archetype, "maker");
});

test("the archetype follows where the time went", () => {
  const base = { byCategory: { work: 0, communication: 0, distraction: 0, other: 100 }, activeMs: 100, lateNights: 0, focusSessions: 0 };
  assert.equal(archetypeOf({ ...base, lateNights: 8 }), "nightOwl");
  assert.equal(archetypeOf({ ...base, byCategory: { ...base.byCategory, work: 60 } }), "focused");
  assert.equal(archetypeOf({ ...base, byCategory: { ...base.byCategory, communication: 40 } }), "social");
  assert.equal(archetypeOf({ ...base, byCategory: { ...base.byCategory, distraction: 40 } }), "explorer");
});

test("the nudge comes in the first days of a month, once", () => {
  assert.equal(retroDue(now, null), "2026-11");
  assert.equal(retroDue(now, "2026-11"), null);
  assert.equal(retroDue(new Date(2026, 10, 15).getTime(), null), null);
  assert.equal(dayKey(new Date(2026, 0, 5)), "2026-01-05");
});
