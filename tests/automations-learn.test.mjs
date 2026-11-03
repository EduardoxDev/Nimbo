import assert from "node:assert/strict";
import test from "node:test";
import { appToken, covered, launchNames, learn, nextToAnnounce, parseLearnState, pending, recentDays, titleOf } from "../src/automations/learn.ts";
import { demoLogs } from "../src/demo/learnDemo.ts";

const NOW = new Date(2026, 10, 3, 12, 0);
const copy = { endOfDaySay: "Quase hora de encerrar." };

test("finds the morning apps, the app that follows another, meetings and the end of the day", () => {
  const found = learn(demoLogs(NOW), copy);
  const kinds = found.map((suggestion) => suggestion.kind);
  assert.ok(kinds.includes("morning"));
  assert.ok(kinds.includes("followup"));
  assert.ok(kinds.includes("meeting"));
  assert.ok(kinds.includes("endOfDay"));
  const morning = found.find((suggestion) => suggestion.kind === "morning");
  assert.deepEqual(morning.trigger.days, [1, 2, 3, 4, 5]);
  assert.match(morning.trigger.time, /^09:0[05]$/);
  assert.ok(morning.apps.includes("code.exe"));
  assert.ok(morning.actions.every((action) => action.kind === "open"));
  const follow = found.find((suggestion) => suggestion.id === "followup:code.exe>windowsterminal.exe");
  assert.ok(follow, "VS Code is always followed by the terminal");
  assert.equal(follow.trigger.app, "Code");
  assert.equal(follow.actions[0].app, "Terminal");
  const end = found.find((suggestion) => suggestion.kind === "endOfDay");
  assert.match(end.trigger.time, /^18:/);
});

test("needs a few days of use before suggesting anything", () => {
  assert.deepEqual(learn(demoLogs(NOW).slice(0, 2), copy), []);
  assert.deepEqual(learn([], copy), []);
});

test("ignores Windows shell windows and Nimbo itself", () => {
  const logs = demoLogs(NOW).map((log) => ({ ...log, segments: log.segments.map((segment) => ({ ...segment, app: segment.app === "code.exe" ? "explorer.exe" : segment.app })) }));
  const found = learn(logs, copy);
  assert.ok(found.every((suggestion) => !suggestion.apps.includes("explorer.exe")));
});

test("a suggestion disappears once accepted, dismissed or already covered by a rule", () => {
  const found = learn(demoLogs(NOW), copy);
  const morning = found.find((suggestion) => suggestion.kind === "morning");
  const rule = { id: "r", text: "x", enabled: true, trigger: { kind: "time", time: "09:15", days: [1, 2, 3, 4, 5] }, action: { kind: "open", app: "Visual Studio Code" } };
  assert.equal(covered(morning, [rule]), true);
  assert.equal(covered(morning, [{ ...rule, trigger: { kind: "time", time: "15:00" } }]), false);
  assert.ok(!pending(found, [rule], {}).includes(morning));
  assert.ok(!pending(found, [], { [morning.id]: "dismissed" }).includes(morning));
  assert.deepEqual(parseLearnState('{"a":"accepted","b":"x"}'), { a: "accepted" });
  assert.deepEqual(parseLearnState("nope"), {});
});

test("app names work for the trigger and for opening from the Start menu", () => {
  assert.equal(appToken("ms-teams.exe"), "Teams");
  assert.equal(appToken("code.exe"), "Code");
  assert.deepEqual(launchNames("code.exe").slice(0, 2), ["Visual Studio Code", "VS Code"]);
  assert.equal(recentDays(NOW, 3)[0], "2026-11-03");
});

test("the island announces each strong habit only once", () => {
  const found = learn(demoLogs(NOW), copy);
  const first = nextToAnnounce(found, []);
  assert.ok(first && first.score >= 0.75);
  const second = nextToAnnounce(found, [first.id]);
  assert.notEqual(second?.id, first.id);
  assert.equal(nextToAnnounce(found, found.map((suggestion) => suggestion.id)), null);
  assert.equal(titleOf(found.find((suggestion) => suggestion.kind === "followup"), { morning: "m", followup: (a, b) => `${b}+${a}`, endOfDay: "e", night: "n", meeting: "r" }), "Terminal+VS Code");
});
