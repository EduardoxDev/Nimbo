import assert from "node:assert/strict";
import test from "node:test";
import { daysSince, nextTip, parseSeen } from "../src/tips/tips.ts";

const quiet = { copiedLink: false, focusRunning: false, focusGuardOn: false, musicPlaying: false, phoneOn: false, daysUsed: 0 };
const fresh = { seen: [], lastAt: 0, off: false, now: 10 * 86_400_000 };

test("the tip matches what the user is doing right now", () => {
  assert.equal(nextTip({ ...quiet, copiedLink: true, musicPlaying: true }, fresh), "copiedLink");
  assert.equal(nextTip({ ...quiet, focusRunning: true }, fresh), "focusGuard");
  assert.equal(nextTip({ ...quiet, focusRunning: true, focusGuardOn: true }, fresh), null);
  assert.equal(nextTip({ ...quiet, daysUsed: 3 }, fresh), "launcher");
  assert.equal(nextTip({ ...quiet, daysUsed: 3 }, { ...fresh, seen: ["launcher"] }), "phone");
  assert.equal(nextTip({ ...quiet, daysUsed: 3, phoneOn: true }, { ...fresh, seen: ["launcher"] }), null);
});

test("tips are rare and can be turned off", () => {
  assert.equal(nextTip({ ...quiet, copiedLink: true }, { ...fresh, seen: ["copiedLink"] }), null);
  assert.equal(nextTip({ ...quiet, copiedLink: true }, { ...fresh, lastAt: fresh.now - 3_600_000 }), null);
  assert.equal(nextTip({ ...quiet, copiedLink: true }, { ...fresh, off: true }), null);
});

test("seen tips survive bad storage", () => {
  assert.deepEqual(parseSeen('["music","nope"]'), ["music"]);
  assert.deepEqual(parseSeen("{oops"), []);
  assert.equal(daysSince(0, 2.5 * 86_400_000), 2);
});
