import assert from "node:assert/strict";
import test from "node:test";
import { dueReminder, parseReminder, parseReminders } from "../src/reminders/reminders.ts";

const now = new Date(2026, 9, 31, 14, 0).getTime();
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();

test("reminders in Portuguese", () => {
  assert.deepEqual(parseReminder("me lembra de ligar pro João às 16h", now), { text: "ligar pro João", at: at(31, 16) });
  assert.deepEqual(parseReminder("me lembre de beber água em 10 minutos", now), { text: "beber água", at: now + 10 * 60_000 });
  assert.deepEqual(parseReminder("lembrar de pagar a conta as 9:30", now), { text: "pagar a conta", at: at(32, 9, 30) });
  assert.deepEqual(parseReminder("me lembra de enviar o PR amanhã às 10h30", now), { text: "enviar o PR", at: at(32, 10, 30) });
  assert.deepEqual(parseReminder("me lembra de alongar daqui a 2 horas", now), { text: "alongar", at: now + 2 * 3_600_000 });
});

test("reminders in English and Chinese", () => {
  assert.deepEqual(parseReminder("remind me to call mom at 4pm", now), { text: "call mom", at: at(31, 16) });
  assert.deepEqual(parseReminder("remind me to stretch in 15 min", now), { text: "stretch", at: now + 15 * 60_000 });
  assert.deepEqual(parseReminder("10分钟后提醒我喝水", now), { text: "喝水", at: now + 10 * 60_000 });
});

test("anything else is not a reminder", () => {
  assert.equal(parseReminder("calculadora", now), null);
  assert.equal(parseReminder("me lembra de algo", now), null);
  assert.equal(parseReminder("me lembra às 16h", now), null);
  assert.equal(parseReminder("remind me to x at 25", now), null);
});

test("stored reminders come back and the oldest due one shows first", () => {
  const list = parseReminders(JSON.stringify([{ id: "a", text: "b", at: now + 5 }, { id: "c", text: "d", at: now - 5 }, { nope: 1 }]));
  assert.equal(list.length, 2);
  assert.equal(dueReminder(list, now)?.id, "c");
  assert.equal(dueReminder(list, now - 10), null);
  assert.deepEqual(parseReminders("{"), []);
});
