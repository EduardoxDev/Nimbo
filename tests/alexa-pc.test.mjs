import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { agendaOfToday, pinHashOf, validPin, validPinHash } from "../src/phone/alexa.ts";

const require = createRequire(import.meta.url);
const skill = require("../alexa/skill/lambda/nimbo.js");

test("the PC and the skill hash the PIN the same way", async () => {
  const hash = await pinHashOf("4821");
  assert.equal(hash, skill.pinHash("4821"));
  assert.equal(validPinHash(hash), true);
  assert.equal(validPin("4821"), true);
  assert.equal(validPin("12"), false);
  assert.equal(validPin("12a4"), false);
});

test("the agenda for Alexa keeps only what is left of today", () => {
  const now = new Date(2026, 10, 2, 14, 0).getTime();
  const at = (hour, minute = 0, day = 2) => new Date(2026, 10, day, hour, minute).getTime();
  const events = [
    { title: "Café", start: at(9), end: at(10), allDay: false },
    { title: "Reunião", start: at(16, 30), end: at(17), allDay: false },
    { title: "Feriado", start: at(0), end: at(0, 0, 3), allDay: true },
    { title: "Amanhã", start: at(9, 0, 3), end: at(10, 0, 3), allDay: false },
  ];
  const agenda = agendaOfToday(events, now, (time) => new Date(time).toTimeString().slice(0, 5));
  assert.deepEqual(agenda.map((item) => item.title), ["Feriado", "Reunião"]);
  assert.equal(agenda[1].time, "16:30");
  assert.equal(agenda[0].time, "");
});
