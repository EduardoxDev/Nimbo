import assert from "node:assert/strict";
import test from "node:test";
import { distractionOf } from "../src/life/distraction.ts";
import { prettyApp, recordHabit, suggestHabit } from "../src/life/habits.ts";
import { summaryParts } from "../src/life/summary.ts";

test("distracting sites are spotted by the window title", () => {
  assert.equal(distractionOf("Lofi girl - YouTube - Google Chrome", "chrome.exe"), "YouTube");
  assert.equal(distractionOf("Instagram • Fotos", "msedge.exe"), "Instagram");
  assert.equal(distractionOf("nimbo – VS Code", "code.exe"), null);
  assert.equal(distractionOf("Biblioteca", "steamwebhelper.exe"), "Steam");
});

test("an app opened at the same hour on three days becomes a habit", () => {
  const code = "C:\\Apps\\code.exe";
  let habits = {};
  for (const day of [5, 12, 19]) habits = recordHabit(habits, code, new Date(2026, 9, day, 9, 5));
  habits = recordHabit(habits, code, new Date(2026, 9, 19, 9, 30));
  const monday = new Date(2026, 9, 26, 9, 2);
  assert.equal(suggestHabit(habits, monday, ""), code);
  assert.equal(suggestHabit(habits, monday, code), null);
  assert.equal(suggestHabit(habits, new Date(2026, 9, 26, 15, 0), ""), null);
  assert.deepEqual(recordHabit({}, "C:\\Windows\\explorer.exe", monday), {});
  assert.equal(prettyApp(code), "Code");
});

test("the day summary adds the water percent", () => {
  const parts = summaryParts({ todos: 3, focus: 2, agents: 1, waterMl: 1500, goalMl: 2000, pending: 4 });
  assert.equal(parts.waterPercent, 75);
  assert.equal(parts.quiet, false);
  assert.equal(summaryParts({ todos: 0, focus: 0, agents: 0, waterMl: 0, goalMl: 0, pending: 0 }).quiet, true);
});
