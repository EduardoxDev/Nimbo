import assert from "node:assert/strict";
import test from "node:test";
import { contextPageOf, initialContextMemory, MANUAL_HOLD_MS, nextContextPage } from "../src/context/contextPage.ts";

const calm = { app: "chrome.exe", meeting: false, agentBusy: false, focusRunning: false, musicPlaying: false };

test("the context picks the page that fits", () => {
  assert.equal(contextPageOf({ ...calm, meeting: true, musicPlaying: true }), "calendar");
  assert.equal(contextPageOf({ ...calm, app: "Code.exe", agentBusy: true }), "agents");
  assert.equal(contextPageOf({ ...calm, app: "C:\\Program Files\\WindowsApps\\WindowsTerminal.exe", agentBusy: true }), "agents");
  assert.equal(contextPageOf({ ...calm, agentBusy: true }), null, "an agent alone does not pull you away from the browser");
  assert.equal(contextPageOf({ ...calm, focusRunning: true, musicPlaying: true }), "focus");
  assert.equal(contextPageOf({ ...calm, app: "Spotify.exe" }), "music");
  assert.equal(contextPageOf({ ...calm, musicPlaying: true }), "music");
  assert.equal(contextPageOf(calm), null);
  assert.equal(contextPageOf({ ...calm, app: null }), null);
});

test("the island only moves when it is closed and the context changed", () => {
  const start = initialContextMemory();
  const opened = nextContextPage(start, "music", "hub", MANUAL_HOLD_MS, true);
  assert.equal(opened.page, null, "never under the cursor");
  assert.equal(opened.memory, start, "the change waits for the island to close");

  const moved = nextContextPage(start, "music", "hub", MANUAL_HOLD_MS, false);
  assert.equal(moved.page, "music");
  const again = nextContextPage(moved.memory, "music", "hub", MANUAL_HOLD_MS + 5_000, false);
  assert.equal(again.page, null, "going back to another page by hand is not undone");
});

test("a page chosen by hand is respected for a while", () => {
  const now = 50 * 60_000;
  const memory = { lastSuggested: null, manualAt: now - 60_000 };
  const held = nextContextPage(memory, "agents", "todo", now, false);
  assert.equal(held.page, null);
  assert.equal(held.memory.lastSuggested, "agents");
  const later = nextContextPage({ ...memory, manualAt: now - MANUAL_HOLD_MS - 1 }, "agents", "todo", now, false);
  assert.equal(later.page, "agents");
});

test("no suggestion keeps the current page", () => {
  const moved = nextContextPage(initialContextMemory(), "music", "hub", MANUAL_HOLD_MS, false);
  const quiet = nextContextPage(moved.memory, null, "music", MANUAL_HOLD_MS * 2, false);
  assert.equal(quiet.page, null);
  assert.equal(quiet.memory.lastSuggested, null);
  assert.equal(nextContextPage(quiet.memory, "music", "music", MANUAL_HOLD_MS * 3, false).page, null, "already there");
});
