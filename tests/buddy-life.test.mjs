import assert from "node:assert/strict";
import test from "node:test";
import { parseMessage, stamp, vitalOf } from "../src/buddy/channel.ts";
import { auraOf, isRub, parsePet } from "../src/buddy/pet.ts";

test("Nimbo's mood follows the hour, the water and recent wins", () => {
  const now = 1_000_000_000;
  assert.equal(vitalOf({ hour: 14, waterProgress: 0.6, celebratedAt: now - 60_000, now }), "happy");
  assert.equal(vitalOf({ hour: 23, waterProgress: 1, celebratedAt: 0, now }), "sleepy");
  assert.equal(vitalOf({ hour: 16, waterProgress: 0.1, celebratedAt: 0, now }), "thirsty");
  assert.equal(vitalOf({ hour: 9, waterProgress: 0, celebratedAt: 0, now }), null);
  assert.equal(vitalOf({ hour: 16, waterProgress: 0.6, celebratedAt: 0, now }), null);
});

test("messages to the buddy expire and must have a known kind", () => {
  const message = stamp({ kind: "say", text: "oi" }, 1000);
  assert.equal(parseMessage(JSON.stringify(message), 2000)?.kind, "say");
  assert.equal(parseMessage(JSON.stringify(message), 10_000), null);
  assert.equal(parseMessage(JSON.stringify({ ...message, kind: "boom" }), 2000), null);
  assert.equal(parseMessage("{", 2000), null);
});

test("rubbing back and forth counts as petting", () => {
  const rub = [0, 10, 0, 10, 0, 10].map((x, index) => ({ x, t: index * 50 }));
  assert.equal(isRub(rub), true);
  assert.equal(isRub([0, 10, 20, 30, 40].map((x, index) => ({ x, t: index * 50 }))), false);
  assert.deepEqual(parsePet("nope"), { affection: 0, lastSeen: 0 });
  assert.equal(auraOf(2), null);
  assert.equal(auraOf(3), "sparkle");
  assert.equal(auraOf(5), "wings");
});
