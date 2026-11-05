import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REACH, loadReach, shouldReach, spokenText } from "../src/reach/reach.ts";

const store = (value) => ({ getItem: () => (value === undefined ? null : JSON.stringify(value)) });

test("the house is only called when you are away and something is set up", () => {
  const config = { ...DEFAULT_REACH, speaker: "media_player.echo_sala" };
  assert.equal(shouldReach(DEFAULT_REACH, "agents", 3_600, 0, 1e9), false);
  assert.equal(shouldReach(config, "agents", 60, 0, 1e9), false);
  assert.equal(shouldReach(config, "agents", 5 * 60, 0, 1e9), true);
  assert.equal(shouldReach({ ...config, kinds: { ...config.kinds, meetings: false } }, "meetings", 3_600, 0, 1e9), false);
  // Not twice in a row.
  assert.equal(shouldReach(config, "deliveries", 3_600, 1e9 - 30_000, 1e9), false);
});

test("saved settings are checked", () => {
  assert.deepEqual(loadReach(store(undefined)), DEFAULT_REACH);
  const loaded = loadReach(store({ speaker: "media_player.echo", light: "switch.x", awayMinutes: 7, kinds: { agents: false } }));
  assert.equal(loaded.speaker, "media_player.echo");
  assert.equal(loaded.light, null);
  assert.equal(loaded.awayMinutes, 5);
  assert.deepEqual(loaded.kinds, { agents: false, meetings: true, deliveries: true });
  assert.equal(loadReach(store({ speaker: "media_player.x; rm -rf" })).speaker, null);
});

test("the speaker reads clean words", () => {
  assert.equal(spokenText("🛵 Seu pedido do iFood chegou"), "Seu pedido do iFood chegou");
  assert.equal(spokenText("Claude Code · quer rodar npm test"), "Claude Code, quer rodar npm test");
});
