import assert from "node:assert/strict";
import test from "node:test";
import { actionsOf, addRun, firedRules, parseRunLog, rulesForEvent, triggerActive } from "../src/rules/rules.ts";

const base = { headphones: false, battery: null, charging: false, ssid: null, app: "", time: "09:00", day: 1, idleMinutes: 0 };

test("time rules can be limited to some weekdays", () => {
  const trigger = { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5] };
  assert.equal(triggerActive(trigger, base), true);
  assert.equal(triggerActive(trigger, { ...base, day: 0 }), false);
  assert.equal(triggerActive({ kind: "time", time: "09:00" }, { ...base, day: 0 }), true);
});

test("idle rules fire once when the PC has been quiet long enough", () => {
  const rule = { id: "i", text: "x", enabled: true, trigger: { kind: "idle", minutes: 10 }, action: { kind: "lock" } };
  assert.deepEqual(firedRules([rule], { ...base, idleMinutes: 9 }, { ...base, idleMinutes: 10 }).map((item) => item.id), ["i"]);
  assert.deepEqual(firedRules([rule], { ...base, idleMinutes: 10 }, { ...base, idleMinutes: 11 }), []);
});

test("event rules run on their event and keep several actions", () => {
  const rules = [
    { id: "a", text: "a", enabled: true, trigger: { kind: "focusStart" }, action: { kind: "pause" }, actions: [{ kind: "pause" }, { kind: "volume", level: 20 }] },
    { id: "b", text: "b", enabled: false, trigger: { kind: "focusStart" }, action: { kind: "pause" } },
    { id: "c", text: "c", enabled: true, trigger: { kind: "claudeDone" }, action: { kind: "say", text: "pronto" } },
  ];
  assert.deepEqual(rulesForEvent(rules, "focusStart").map((rule) => rule.id), ["a"]);
  assert.equal(actionsOf(rules[0]).length, 2);
  assert.deepEqual(actionsOf(rules[2]), [{ kind: "say", text: "pronto" }]);
  assert.equal(triggerActive({ kind: "focusStart" }, base), false);
});

test("the run history keeps the newest first", () => {
  let log = parseRunLog("{");
  log = addRun(log, { id: "1", ruleId: "a", name: "a", at: 1, ok: true });
  log = addRun(log, { id: "2", ruleId: "b", name: "b", at: 2, ok: false, error: "x" });
  assert.deepEqual(log.map((run) => run.id), ["2", "1"]);
  assert.equal(parseRunLog(JSON.stringify(log)).length, 2);
});
