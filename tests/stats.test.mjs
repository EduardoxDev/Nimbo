import assert from "node:assert/strict";
import test from "node:test";
import { addStat, evolutionOf, parseStats, statsDays } from "../src/stats/stats.ts";
import { contextAccessory, earnedAccessory, mascotAccessory } from "../src/mascot/accessories.ts";

const noon = new Date(2026, 9, 31, 12).getTime();

test("stats count per day and keep the week in order", () => {
  let history = addStat({}, "focus", noon);
  history = addStat(history, "focus", noon);
  history = addStat(history, "todos", noon - 86_400_000);
  const week = statsDays(history, noon);
  assert.equal(week.length, 7);
  assert.equal(week[6].stats.focus, 2);
  assert.equal(week[6].isToday, true);
  assert.equal(week[5].stats.todos, 1);
  assert.deepEqual(parseStats("nope"), {});
  assert.deepEqual(parseStats(JSON.stringify({ "2026-10-31": { focus: 3 }, bad: {} })), { "2026-10-31": { focus: 3, todos: 0, agents: 0 } });
});

test("points raise the mascot level", () => {
  assert.deepEqual(evolutionOf({}, 0), { level: 1, points: 0, nextAt: 10 });
  const evolution = evolutionOf({ "2026-10-31": { focus: 5, todos: 4, agents: 2 } }, 2);
  assert.equal(evolution.points, 22);
  assert.equal(evolution.level, 2);
  assert.equal(evolution.nextAt, 30);
});

test("the mascot dresses for the hour, the weather and its level", () => {
  assert.equal(contextAccessory(23, null), "nightcap");
  assert.equal(contextAccessory(14, { code: 63, isDay: true }), "umbrella");
  assert.equal(contextAccessory(14, { code: 0, isDay: true }), "sunglasses");
  assert.equal(contextAccessory(14, { code: 3, isDay: true }), null);
  assert.equal(earnedAccessory(1), null);
  assert.equal(earnedAccessory(3), "headphones");
  assert.equal(earnedAccessory(6), "crown");
  assert.equal(mascotAccessory(14, { code: 3, isDay: true }, 4), "tophat");
});
