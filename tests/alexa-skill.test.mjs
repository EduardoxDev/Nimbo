import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { answer, needsPc, pinHash } = require("../alexa/skill/lambda/nimbo.js");
const { codeFromSpeech } = require("../alexa/skill/lambda/code.js");
const model = require("../alexa/skill/skill-package/interactionModels/custom/pt-BR.json");

const status = {
  focus: { status: "running", phase: "focus", remainingMs: 12 * 60_000, totalMs: 25 * 60_000 },
  water: { drankMl: 1200, goalMl: 2000 },
  music: { title: "Lofi", artist: "Nimbo", playing: true },
  tasks: [
    { id: "1", title: "comprar pão", completed: false },
    { id: "2", title: "pagar luz", completed: false },
    { id: "3", title: "feito", completed: true },
  ],
  agenda: [{ title: "Reunião", time: "16:30", allDay: false }],
  approval: { id: "ap1", agent: "Claude Code", question: "Rodar: npm test" },
  alexaPinHash: pinHash("4821"),
};

test("questions are answered from the PC status", () => {
  assert.match(answer("FocusStatusIntent", {}, status).speech, /12 minutos/);
  assert.match(answer("WaterStatusIntent", {}, status).speech, /60 por cento/);
  assert.match(answer("TasksListIntent", {}, status).speech, /2 tarefas: comprar pão e pagar luz/);
  assert.match(answer("AgendaIntent", {}, status).speech, /Reunião às 16:30/);
  assert.match(answer("NowPlayingIntent", {}, status).speech, /Tocando: Lofi, de Nimbo/);
  assert.match(answer("StatusIntent", {}, status).speech, /Claude Code esperando/);
});

test("actions become commands the PC already knows", () => {
  assert.deepEqual(answer("WaterAddIntent", {}, status).command, { action: "water_add" });
  assert.deepEqual(answer("TaskAddIntent", { task: { value: "ligar pro João" } }, status).command, { action: "task_add", value: "ligar pro João" });
  assert.deepEqual(answer("PlayPauseIntent", {}, status).command, { action: "play_pause" });
  assert.deepEqual(answer("FocusPauseIntent", {}, status).command, { action: "focus_pause" });
  assert.equal(answer("FocusStartIntent", {}, status).command, undefined);
  assert.deepEqual(answer("FocusStartIntent", {}, { ...status, focus: { status: "idle" } }).command, { action: "focus_start" });
  assert.deepEqual(answer("LockIntent", {}, status).command, { action: "lock" });
});

test("approving by voice needs the right PIN and is off without one", () => {
  assert.equal(answer("ApproveIntent", { pin: { value: "1111" } }, status).command, undefined);
  assert.deepEqual(answer("ApproveIntent", { pin: { value: "4821" } }, status).command, { action: "approve", value: "ap1" });
  assert.match(answer("ApproveIntent", { pin: { value: "4821" } }, { ...status, alexaPinHash: undefined }).speech, /desligado/);
  assert.deepEqual(answer("DenyIntent", {}, status).command, { action: "deny", value: "ap1" });
});

test("empty states have friendly answers", () => {
  assert.match(answer("TasksListIntent", {}, {}).speech, /Nenhuma tarefa/);
  assert.match(answer("AgendaIntent", {}, {}).speech, /Nada mais/);
  assert.match(answer("StatusIntent", {}, {}).speech, /Tudo tranquilo/);
  assert.equal(codeFromSpeech("48 21 13"), "482113");
});

test("every intent in the voice model is handled", () => {
  const custom = model.interactionModel.languageModel.intents.map((intent) => intent.name).filter((name) => !name.startsWith("AMAZON."));
  for (const name of custom) {
    if (name === "ConnectIntent" || name === "DisconnectIntent") continue;
    assert.equal(needsPc(name), true, name);
    assert.doesNotMatch(answer(name, {}, status).speech, /Não entendi/, name);
  }
});
