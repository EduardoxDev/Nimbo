import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ROUTINES, normalizeRoutines, routineDue, routineOf } from "../src/routines/routines.ts";
import { appReminderMatches, parseAppReminder } from "../src/reminders/reminders.ts";

test("routines are asked for in three languages", () => {
  for (const text of ["bom dia", "Começar o dia", "começa o dia!", "start my day", "Good morning", "开始一天"]) {
    assert.equal(routineOf(text), "start", text);
  }
  for (const text of ["encerrar o dia", "boa noite", "end the day", "结束一天"]) assert.equal(routineOf(text), "end", text);
  for (const text of ["bom dia pessoal", "chrome", "dia"]) assert.equal(routineOf(text), null, text);
});

test("stored routines are cleaned up", () => {
  assert.deepEqual(normalizeRoutines(null), DEFAULT_ROUTINES);
  const routines = normalizeRoutines({
    start: { apps: [{ name: "Code", id: "a" }, { name: "Code", id: "a" }, { bad: 1 }], ac: "on", acTemperature: 40, focus: "weird", time: "7:00" },
  });
  assert.deepEqual(routines.start.apps, [{ name: "Code", id: "a" }]);
  assert.equal(routines.start.acTemperature, 30);
  assert.equal(routines.start.focus, "keep");
  assert.equal(routines.start.time, "");
  assert.equal(routines.end.music, "pause");
});

test("a routine with a time is due only at that minute", () => {
  const routine = { ...DEFAULT_ROUTINES.start, time: "08:30" };
  assert.equal(routineDue(routine, new Date(2026, 10, 2, 8, 30)), true);
  assert.equal(routineDue(routine, new Date(2026, 10, 2, 8, 31)), false);
  assert.equal(routineDue(DEFAULT_ROUTINES.start, new Date(2026, 10, 2, 8, 30)), false);
});

test("reminders for when an app opens", () => {
  assert.deepEqual(parseAppReminder("quando eu abrir o VS Code, me lembra de mandar o PR"), { app: "VS Code", text: "mandar o PR" });
  assert.deepEqual(parseAppReminder("me lembra de responder a Ana quando abrir o WhatsApp"), { app: "WhatsApp", text: "responder a Ana" });
  assert.deepEqual(parseAppReminder("remind me to check the build when I open Slack"), { app: "Slack", text: "check the build" });
  assert.deepEqual(parseAppReminder("打开微信时提醒我回复妈妈"), { app: "微信", text: "回复妈妈" });
  assert.equal(parseAppReminder("me lembra de beber água às 16h"), null);
});

test("the app in front is matched by program or title", () => {
  const code = { path: "C:/Users/a/AppData/Local/Programs/Microsoft VS Code/Code.exe", title: "App.tsx - nimbo - Visual Studio Code" };
  assert.equal(appReminderMatches("VS Code", code), true);
  assert.equal(appReminderMatches("Word", { path: "C:/Office/WINWORD.EXE", title: "Documento1 - Word" }), true);
  assert.equal(appReminderMatches("WhatsApp", { path: "C:/x/WhatsApp.exe", title: "WhatsApp" }), true);
  assert.equal(appReminderMatches("Slack", code), false);
  assert.equal(appReminderMatches("Code", { path: "C:/x/chrome.exe", title: "Barcode reader" }), false);
});
