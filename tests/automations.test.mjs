import assert from "node:assert/strict";
import test from "node:test";
import { callsFor, dueAutomations, minuteKey, normalizeAutomations } from "../src/home/automations.ts";

const base = {
  id: "a",
  enabled: true,
  time: "22:00",
  days: [1, 2, 3, 4, 5],
  entityId: "climate.quarto",
  entityName: "Quarto",
  action: "on",
  temperature: 23,
};

test("automations run once at their minute on chosen days", () => {
  const monday = new Date(2026, 10, 2, 22, 0, 10);
  assert.deepEqual(dueAutomations([base], monday, {}).map((item) => item.id), ["a"]);
  assert.deepEqual(dueAutomations([base], monday, { a: minuteKey(monday) }), []);
  assert.deepEqual(dueAutomations([base], new Date(2026, 10, 1, 22, 0), {}), []);
  assert.deepEqual(dueAutomations([base], new Date(2026, 10, 2, 22, 1), {}), []);
  assert.deepEqual(dueAutomations([{ ...base, enabled: false }], monday, {}), []);
  assert.deepEqual(dueAutomations([{ ...base, days: [] }], new Date(2026, 10, 1, 22, 0), {}).length, 1);
});

test("turning on can also set the temperature", () => {
  assert.deepEqual(callsFor(base).map((call) => call.service), ["turn_on", "set_temperature"]);
  assert.deepEqual(callsFor({ ...base, action: "off" }).map((call) => call.service), ["turn_off"]);
});

test("stored automations are validated", () => {
  const parsed = normalizeAutomations([base, { ...base, id: "b", time: "25:00" }, { nope: true }]);
  assert.equal(parsed.length, 1);
  assert.deepEqual(normalizeAutomations("x"), []);
});
