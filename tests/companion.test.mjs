import assert from "node:assert/strict";
import test from "node:test";
import { addNote, EMPTY_COMPANION, focusStreak, forgetOld, greetingOf, loadCompanion, noteOf, shouldGreet } from "../src/companion/companion.ts";

// Thursday 2026-11-05, 08:30.
const NOW = new Date(2026, 10, 5, 8, 30).getTime();
const copy = {
  hello: (hour) => (hour < 12 ? "Bom dia!" : "Oi!"),
  today: (text) => `Hoje é o dia da ${text}. Boa sorte!`,
  howWas: (text) => `E aí, como foi a ${text}?`,
  yesterday: (focus, todos) => `Ontem: ${focus} focos e ${todos} tarefas.`,
  streak: (days) => `🔥 ${days} dias seguidos de foco.`,
  agenda: (count, first) => `Hoje tem ${count} compromissos, o primeiro às ${first}.`,
};

test("it understands what you ask it to remember", () => {
  assert.deepEqual(noteOf("lembra que amanhã tenho uma entrevista", NOW), { text: "entrevista", on: "2026-11-06" });
  assert.deepEqual(noteOf("Ei Nimbo, não esquece: sexta-feira eu tenho prova de cálculo!", NOW), { text: "prova de cálculo", on: "2026-11-06" });
  assert.deepEqual(noteOf("remember that tomorrow I have a job interview", NOW), { text: "job interview", on: "2026-11-06" });
  // Thursday → next Thursday, not today.
  assert.equal(noteOf("lembra que quinta tenho dentista", NOW).on, "2026-11-12");
  assert.equal(noteOf("lembra de comprar pão", NOW), null);
  assert.equal(noteOf("amanhã tenho prova", NOW), null);
});

test("the good morning wishes luck, asks how it went and tells the day", () => {
  let state = addNote(EMPTY_COMPANION, { text: "entrevista", on: "2026-11-05" }, NOW);
  state = addNote(state, { text: "apresentação", on: "2026-11-04" }, NOW);
  const history = { "2026-11-02": { focus: 1, todos: 0, agents: 0 }, "2026-11-03": { focus: 2, todos: 1, agents: 0 }, "2026-11-04": { focus: 4, todos: 6, agents: 0 } };
  const events = [{ start: NOW + 90 * 60_000, allDay: false }, { start: NOW + 5 * 3_600_000, allDay: false }, { start: NOW, allDay: true }];
  const text = greetingOf({ now: NOW, history, notes: state.notes, events, formatTime: () => "10:00" }, copy);
  assert.equal(
    text,
    "Bom dia! Hoje é o dia da entrevista. Boa sorte! E aí, como foi a apresentação? Ontem: 4 focos e 6 tarefas. 🔥 3 dias seguidos de foco.",
  );
  assert.equal(greetingOf({ now: NOW, history: {}, notes: [], events, formatTime: () => "10:00" }, copy), "Bom dia! Hoje tem 2 compromissos, o primeiro às 10:00.");
});

test("once a day, from the morning, and old notes go away", () => {
  assert.equal(shouldGreet(EMPTY_COMPANION, NOW), true);
  assert.equal(shouldGreet({ ...EMPTY_COMPANION, lastGreetDay: "2026-11-05" }, NOW), false);
  assert.equal(shouldGreet(EMPTY_COMPANION, new Date(2026, 10, 5, 3, 0).getTime()), false);
  const state = addNote(addNote(EMPTY_COMPANION, { text: "velha", on: "2026-11-01" }, NOW), { text: "nova", on: "2026-11-04" }, NOW);
  assert.deepEqual(forgetOld(state, NOW).notes.map((note) => note.text), ["nova"]);
  assert.equal(focusStreak({ "2026-11-05": { focus: 1, todos: 0, agents: 0 }, "2026-11-04": { focus: 1, todos: 0, agents: 0 } }, NOW), 2);
  assert.deepEqual(loadCompanion({ getItem: () => "{bad" }), EMPTY_COMPANION);
});
