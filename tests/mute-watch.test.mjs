import assert from "node:assert/strict";
import test from "node:test";
import { IDLE_MUTE_WATCH, watchMute } from "../src/mic/muteWatch.ts";

const on = { muted: false, volume: 1, peak: 0 };
const off = { muted: true, volume: 1, peak: 0 };
const offLoud = { muted: true, volume: 1, peak: 0.3 };

test("a call that starts muted warns once", () => {
  let step = watchMute(IDLE_MUTE_WATCH, { callId: "c1", callStart: 0, reading: off, now: 2_000 });
  assert.equal(step.alert, "startedMuted");
  step = watchMute(step.watch, { callId: "c1", callStart: 0, reading: off, now: 4_000 });
  assert.equal(step.alert, null);
});

test("muting on purpose mid-call says nothing", () => {
  let step = watchMute(IDLE_MUTE_WATCH, { callId: "c1", callStart: 0, reading: on, now: 2_000 });
  step = watchMute(step.watch, { callId: "c1", callStart: 0, reading: off, now: 60_000 });
  assert.equal(step.alert, null);
});

test("talking while muted warns, but not every second", () => {
  let watch = watchMute(IDLE_MUTE_WATCH, { callId: "c1", callStart: 0, reading: on, now: 1_000 }).watch;
  let step = watchMute(watch, { callId: "c1", callStart: 0, reading: offLoud, now: 60_000 });
  assert.equal(step.alert, null); // one loud sample can be a cough
  step = watchMute(step.watch, { callId: "c1", callStart: 0, reading: offLoud, now: 61_500 });
  assert.equal(step.alert, "speakingMuted");
  step = watchMute(step.watch, { callId: "c1", callStart: 0, reading: offLoud, now: 63_000 });
  step = watchMute(step.watch, { callId: "c1", callStart: 0, reading: offLoud, now: 64_500 });
  assert.equal(step.alert, null);
  // Still talking 30 s later: one more warning.
  step = watchMute(step.watch, { callId: "c1", callStart: 0, reading: offLoud, now: 95_000 });
  assert.equal(step.alert, "speakingMuted");
});

test("a volume at zero counts as muted, and a new call starts fresh", () => {
  const step = watchMute({ ...IDLE_MUTE_WATCH, callId: "old", warnedStart: true }, { callId: "new", callStart: 10_000, reading: { muted: false, volume: 0, peak: 0 }, now: 12_000 });
  assert.equal(step.alert, "startedMuted");
  assert.equal(watchMute(step.watch, { callId: null, callStart: 0, reading: null, now: 13_000 }).watch.callId, null);
});
