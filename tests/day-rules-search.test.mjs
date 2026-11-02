import assert from "node:assert/strict";
import test from "node:test";
import { categoryOf, labelOf, segmentAt, stretches, summarize, hoursText } from "../src/day/activity.ts";
import { estimateMinutes, planDay } from "../src/day/planner.ts";
import { firedRules, isHeadphones, parseRule } from "../src/rules/rules.ts";
import { matchesAll, parseFileQuery } from "../src/launcher/universal.ts";
import { smartMatchOf } from "../src/clipboard/smart.ts";
import { dayRequestOf } from "../src/launcher/launcher.ts";

const at = (hour, minute = 0) => new Date(2026, 10, 2, hour, minute).getTime();

test("apps and sites get names and categories", () => {
  assert.equal(labelOf({ app: "code.exe", title: "App.tsx - nimbo - Visual Studio Code" }), "VS Code");
  assert.equal(labelOf({ app: "chrome.exe", title: "Lo-fi beats - YouTube - Google Chrome" }), "YouTube");
  assert.equal(categoryOf({ app: "chrome.exe", title: "Lo-fi beats - YouTube - Google Chrome" }), "distraction");
  assert.equal(categoryOf({ app: "chrome.exe", title: "EduardoxDev/Nimbo - GitHub - Google Chrome" }), "work");
  assert.equal(categoryOf({ app: "ms-teams.exe", title: "Chat" }), "communication");
  assert.equal(categoryOf({ app: "code.exe", title: "x" }), "work");
});

test("a day is summed up and asked about", () => {
  const day = [
    { app: "code.exe", title: "a - Visual Studio Code", start: at(9), end: at(10) },
    { app: "chrome.exe", title: "Feed - Instagram - Google Chrome", start: at(10), end: at(10, 20) },
    { app: "code.exe", title: "b - Visual Studio Code", start: at(10, 20), end: at(11) },
  ];
  const summary = summarize(day);
  assert.equal(Math.round(summary.byCategory.work / 60_000), 100);
  assert.equal(Math.round(summary.byCategory.distraction / 60_000), 20);
  assert.equal(Math.round(summary.longestFocusMs / 60_000), 60);
  assert.equal(summary.apps[0].label, "VS Code");
  assert.equal(segmentAt(day, at(10, 5))?.title, "Feed - Instagram - Google Chrome");
  assert.equal(stretches(day).length, 3);
  assert.equal(hoursText(95 * 60_000), "1 h 35 min");
});

test("the day plan fits tasks around events", () => {
  assert.equal(estimateMinutes("relatório 30 min"), 30);
  assert.equal(estimateMinutes("estudar 1h30"), 90);
  assert.equal(estimateMinutes("ligar pro João"), 45);
  const plan = planDay(["relatório 30 min", "estudar 1h", "e-mails"], [{ title: "Reunião", start: at(10), end: at(11) }], at(9), 13);
  const tasks = plan.items.filter((item) => item.kind === "task");
  assert.equal(tasks[0].start, at(9));
  assert.equal(tasks[0].end, at(9, 30));
  assert.ok(tasks.every((task) => task.end <= at(10) || task.start >= at(11)));
  assert.ok(plan.items.some((item) => item.kind === "event"));
  assert.deepEqual(planDay(["a", "b", "c", "d"], [], at(12, 30), 13).leftover.length > 0, true);
});

test("rules are written as sentences", () => {
  assert.deepEqual(parseRule("quando conectar o fone, toca minha playlist", null)?.trigger, { kind: "headphones" });
  assert.deepEqual(parseRule("quando conectar o fone, toca minha playlist", null)?.action, { kind: "music", query: "" });
  assert.deepEqual(parseRule("quando a bateria chegar a 20%, me avisa de carregar", null)?.trigger, { kind: "battery", below: 20 });
  assert.deepEqual(parseRule("quando a bateria chegar a 20%, me avisa de carregar", null)?.action, { kind: "notify", text: "carregar" });
  assert.deepEqual(parseRule("quando eu chegar em casa, liga o ar em 23", "Casa 5G"), {
    text: "quando eu chegar em casa, liga o ar em 23",
    trigger: { kind: "wifi", ssid: "Casa 5G" },
    action: { kind: "ac", on: true, temperature: 23 },
  });
  assert.deepEqual(parseRule("todo dia às 9h, começar o dia", null)?.trigger, { kind: "time", time: "09:00" });
  assert.deepEqual(parseRule("when I open Teams, pause the music", null)?.action, { kind: "pause" });
  assert.deepEqual(parseRule("quando abrir o Teams, faz relatório semanal", null)?.action, { kind: "macro", name: "relatório semanal" });
  assert.equal(parseRule("quando eu chegar em casa, liga o ar", null), null);
  assert.equal(parseRule("toca anitta", null), null);
});

test("rules fire once when their trigger turns true", () => {
  const rule = { id: "1", text: "", enabled: true, trigger: { kind: "headphones" }, action: { kind: "pause" } };
  const base = { headphones: false, battery: 80, charging: false, ssid: null, app: "", time: "10:00" };
  assert.deepEqual(firedRules([rule], null, { ...base, headphones: true }), []);
  assert.equal(firedRules([rule], base, { ...base, headphones: true }).length, 1);
  assert.equal(firedRules([rule], { ...base, headphones: true }, { ...base, headphones: true }).length, 0);
  assert.equal(isHeadphones("Fones de ouvido (AirPods Pro)"), true);
  assert.equal(isHeadphones("Alto-falantes (Realtek)"), false);
});

test("files are found by meaning", () => {
  assert.deepEqual(parseFileQuery("aquele PDF do contrato de março"), { terms: ["contrato"], extensions: ["pdf"], month: 3 });
  assert.deepEqual(parseFileQuery("planilha de gastos")?.extensions, ["xlsx", "xls", "csv"]);
  assert.equal(parseFileQuery("o de"), null);
  assert.equal(matchesAll("Endereço da Ana: Rua Augusta", "rua ana"), true);
  assert.equal(matchesAll("Endereço da Ana", "rua"), false);
});

test("copied errors and files get an offer", () => {
  assert.equal(smartMatchOf("TypeError: Cannot read properties of undefined (reading 'map')")?.kind, "error");
  assert.equal(smartMatchOf("Traceback (most recent call last):\n  File \"a.py\", line 1")?.kind, "error");
  assert.deepEqual(smartMatchOf('"C:\\Users\\psico\\Documents\\contrato.pdf"'), { kind: "file", path: "C:\\Users\\psico\\Documents\\contrato.pdf", name: "contrato.pdf" });
  assert.equal(smartMatchOf("Bom dia! Tudo bem?"), null);
});

test("my day opens from the launcher", () => {
  assert.equal(dayRequestOf("meu dia"), "today");
  assert.equal(dayRequestOf("o que eu fiz ontem?"), "today");
  assert.equal(dayRequestOf("raio-x"), "xray");
  assert.equal(dayRequestOf("planejar meu dia"), "plan");
  assert.equal(dayRequestOf("chrome"), null);
});
