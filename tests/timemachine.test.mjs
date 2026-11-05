import assert from "node:assert/strict";
import test from "node:test";
import { timeRequestOf } from "../src/timemachine/timemachine.ts";

// Thursday 2026-11-05, 10:00.
const NOW = new Date(2026, 10, 5, 10, 0).getTime();
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

test("it understands when to go back to", () => {
  assert.equal(timeRequestOf("volta meu PC para ontem às 15h", NOW), at(4, 15));
  assert.equal(timeRequestOf("como estava o pc hoje 8h30", NOW), at(5, 8, 30));
  assert.equal(timeRequestOf("volta pra anteontem as 9:15", NOW), at(3, 9, 15));
  assert.equal(timeRequestOf("restaura às 15h", NOW), at(4, 15));
  assert.equal(timeRequestOf("volta 2 horas", NOW), NOW - 2 * 3_600_000);
  assert.equal(timeRequestOf("volta para 3 horas atrás", NOW), NOW - 3 * 3_600_000);
  assert.equal(timeRequestOf("back to yesterday 3pm", NOW), at(4, 15));
});

test("other things are not time travel", () => {
  assert.equal(timeRequestOf("volta", NOW), null);
  assert.equal(timeRequestOf("abrir chrome", NOW), null);
  assert.equal(timeRequestOf("me lembra às 15h de ligar", NOW), null);
  assert.equal(timeRequestOf("volta às 25h", NOW), null);
});
