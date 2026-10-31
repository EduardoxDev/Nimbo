import assert from "node:assert/strict";
import test from "node:test";
import { nimboMood, statusDots, STATUS_COLORS } from "../src/mascot/nimboMood.ts";

const calm = { hour: 14, focusRunning: false, assistantBusy: false, needsAttention: false, justFinished: false, musicPlaying: false };

test("the island mascot shows what matters most right now", () => {
  assert.equal(nimboMood(calm), "idle");
  assert.equal(nimboMood({ ...calm, focusRunning: true }), "working");
  assert.equal(nimboMood({ ...calm, focusRunning: true, assistantBusy: true }), "thinking");
  assert.equal(nimboMood({ ...calm, focusRunning: true, needsAttention: true }), "waiting");
  assert.equal(nimboMood({ ...calm, justFinished: true }), "done");
  assert.equal(nimboMood({ ...calm, hour: 1 }), "sleeping");
  assert.equal(nimboMood({ ...calm, hour: 1, musicPlaying: true }), "idle");
});

test("status dots list agents first and stop at four", () => {
  assert.deepEqual(statusDots({ music: true, water: true }, []), [STATUS_COLORS.music, STATUS_COLORS.water]);
  assert.equal(statusDots({ music: true, focus: true, calendar: true }, ["#111", "#222"]).length, 4);
  assert.deepEqual(statusDots({}, ["#111"]), ["#111"]);
});
