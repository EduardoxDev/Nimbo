import assert from "node:assert/strict";
import test from "node:test";
import { joinDelay, joinLink, loadAutopilot, nextCall } from "../src/autopilot/autopilot.ts";

const NOW = 1_000_000_000;
const call = (id, startIn, link = "https://meet.google.com/abc-defg-hij") => ({ id, title: id, link, start: NOW + startIn, end: NOW + startIn + 30 * 60_000, allDay: false });

test("the autopilot gets ready for the next call with a link", () => {
  const events = [call("later", 10 * 60_000), call("soon", 45_000), call("nolink", 20_000, null), { ...call("allday", 10_000), allDay: true }];
  assert.equal(nextCall(events, NOW, new Set())?.id, "soon");
  assert.equal(nextCall(events, NOW, new Set(["soon"])), null);
  // Already started a minute ago still counts; long ago does not.
  assert.equal(nextCall([call("late", -60_000)], NOW, new Set())?.id, "late");
  assert.equal(nextCall([call("gone", -5 * 60_000)], NOW, new Set()), null);
  assert.equal(joinDelay(call("soon", 45_000), NOW), 35_000);
  assert.equal(joinDelay(call("late", -60_000), NOW), 0);
});

test("only https links, and off until turned on", () => {
  assert.equal(joinLink({ link: "javascript:alert(1)" }), null);
  assert.equal(joinLink({ link: "https://meet.google.com/x y" }), null);
  assert.equal(joinLink({ link: "https://teams.microsoft.com/l/meetup-join/1" }), "https://teams.microsoft.com/l/meetup-join/1");
  assert.deepEqual(loadAutopilot({ getItem: () => null }), { meetings: false });
  assert.deepEqual(loadAutopilot({ getItem: () => '{"meetings":true}' }), { meetings: true });
  assert.deepEqual(loadAutopilot({ getItem: () => "{oops" }), { meetings: false });
});
