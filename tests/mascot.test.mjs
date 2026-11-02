import assert from "node:assert/strict";
import test from "node:test";
import { blinkAmount, bodyPath, identityOf, mascotFrame, MASCOT_SHAPES } from "../src/mascot/engine.ts";

test("each agent keeps the same shape and color", () => {
  assert.deepEqual(identityOf("Claude Code"), identityOf("Claude Code"));
  assert.ok(MASCOT_SHAPES.includes(identityOf("Codex").shape));
});

test("bodies are closed paths for every shape", () => {
  for (const shape of MASCOT_SHAPES) {
    const path = bodyPath(shape, 1.5, 0.4);
    assert.match(path, /^M[\d.]+ [\d.]+ /);
    assert.ok(path.endsWith("Z"));
  }
});

test("blinks are short and stay between open and closed", () => {
  let closedFrames = 0;
  for (let index = 0; index < 1000; index += 1) {
    const amount = blinkAmount(index / 100, 7);
    assert.ok(amount >= 0 && amount <= 1);
    if (amount > 0) closedFrames += 1;
  }
  assert.ok(closedFrames > 0 && closedFrames < 100);
});

test("moods change the eyes and the status dot", () => {
  assert.equal(mascotFrame({ shape: "cloud", mood: "done", t: 1 }).eyes[0].style, "happy");
  assert.equal(mascotFrame({ shape: "cloud", mood: "error", t: 1 }).eyes[0].style, "closed");
  assert.equal(mascotFrame({ shape: "cloud", mood: "sleeping", t: 1 }).dot, null);
  assert.equal(mascotFrame({ shape: "cloud", mood: "waiting", t: 1 }).dot, "#ff9f0a");
  const right = mascotFrame({ shape: "round", mood: "idle", t: 0.5, gaze: { x: 1, y: 0 } });
  const left = mascotFrame({ shape: "round", mood: "idle", t: 0.5, gaze: { x: -1, y: 0 } });
  assert.ok(right.eyes[0].cx > left.eyes[0].cx);
});

test("arms and antenna only show up for special moments", () => {
  assert.equal(mascotFrame({ shape: "cloud", mood: "idle", t: 1 }).arms.length, 0);
  assert.equal(mascotFrame({ shape: "cloud", mood: "idle", t: 1 }).antenna, null);
  assert.equal(mascotFrame({ shape: "cloud", mood: "greeting", t: 1 }).arms.length, 2);
  assert.equal(mascotFrame({ shape: "cloud", mood: "done", t: 1 }).arms.length, 2);
  assert.ok(mascotFrame({ shape: "cloud", mood: "waiting", t: 1 }).antenna);
});

test("moods change the mouth and a poke makes the body spring", () => {
  assert.equal(mascotFrame({ shape: "cloud", mood: "done", t: 1 }).mouth.style, "grin");
  assert.equal(mascotFrame({ shape: "cloud", mood: "error", t: 1 }).mouth.style, "wavy");
  const still = mascotFrame({ shape: "cloud", mood: "idle", t: 0 }).squash;
  const poked = mascotFrame({ shape: "cloud", mood: "idle", t: 0, poke: 0.07 }).squash;
  assert.ok(Math.abs(poked.y - still.y) > 0.05);
  assert.ok(poked.y > 1 ? poked.x < 1 : poked.x > 1);
});
