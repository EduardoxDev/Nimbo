import assert from "node:assert/strict";
import test from "node:test";
import { allowed, blockedName, cleanBlocklist, DEFAULT_BLOCKLIST, lastWeek, parseFocusLog, recordAttempt, weekKey, weekReport } from "../src/focus/deepFocus.ts";

test("blocks known distractions only when they are on the list", () => {
  assert.equal(blockedName("Lofi beats - YouTube - Google Chrome", "chrome.exe", DEFAULT_BLOCKLIST), "YouTube");
  assert.equal(blockedName("Lofi beats - YouTube - Google Chrome", "chrome.exe", ["Instagram"]), null);
  assert.equal(blockedName("Steam", "steam.exe", DEFAULT_BLOCKLIST), "Steam");
  assert.equal(blockedName("App.tsx - nimbo - Visual Studio Code", "code.exe", DEFAULT_BLOCKLIST), null);
});

test("custom sites and apps match by title or program name", () => {
  assert.equal(blockedName("Notícias - G1 - Google Chrome", "chrome.exe", ["g1"]), null);
  assert.equal(blockedName("Página inicial - Globo Esporte - Google Chrome", "chrome.exe", ["Globo Esporte"]), "Globo Esporte");
  assert.equal(blockedName("Roblox", "RobloxPlayerBeta.exe", ["roblox"]), "roblox");
  assert.equal(blockedName("Discord", "discord.exe", ["Discord"]), "Discord");
});

test("the blocklist is cleaned and deduplicated", () => {
  assert.deepEqual(cleanBlocklist(["YouTube", " youtube ", "", "Discord"]), ["YouTube", "Discord"]);
  assert.deepEqual(cleanBlocklist("nope"), DEFAULT_BLOCKLIST);
});

test("a 5 minute pass only covers that site", () => {
  const now = 1_000_000;
  const passes = { YouTube: now + 60_000 };
  assert.equal(allowed(passes, "YouTube", now), true);
  assert.equal(allowed(passes, "Instagram", now), false);
  assert.equal(allowed(passes, "YouTube", now + 120_000), false);
});

test("the weekly report adds focus sessions and the biggest distraction", () => {
  const now = new Date(2026, 10, 9, 9, 0);
  const days = lastWeek(now);
  assert.deepEqual([days[0], days[6]], ["2026-11-02", "2026-11-08"]);
  let log = {};
  for (let index = 0; index < 5; index++) log = recordAttempt(log, "YouTube", new Date(2026, 10, 3, 10, index).getTime());
  log = recordAttempt(log, "Instagram", new Date(2026, 10, 4, 15).getTime());
  log = recordAttempt(log, "YouTube", new Date(2026, 10, 9, 9).getTime());
  const stats = { "2026-11-03": { focus: 4, todos: 0, agents: 0 }, "2026-11-05": { focus: 6, todos: 0, agents: 0 }, "2026-11-09": { focus: 9, todos: 0, agents: 0 } };
  const report = weekReport(stats, parseFocusLog(JSON.stringify(log)), days, 25);
  assert.deepEqual(report, { sessions: 10, minutes: 250, bestDay: "2026-11-05", attempts: 6, top: { name: "YouTube", count: 5 } });
  assert.equal(weekKey(now), "2026-11-09");
  assert.equal(weekKey(new Date(2026, 10, 8)), "2026-11-02");
  assert.deepEqual(parseFocusLog("x"), {});
});
