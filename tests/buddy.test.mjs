import assert from "node:assert/strict";
import test from "node:test";
import { BUDDY_SIZE, follow, step, supportsOf, throwVelocity } from "../src/buddy/physics.ts";
import { appAccessory } from "../src/mascot/accessories.ts";

const supports = supportsOf([{ left: 100, right: 500, top: 300 }], 1000, 1920);

function run(body, seconds) {
  let current = body;
  let impact = 0;
  for (let time = 0; time < seconds; time += 1 / 60) {
    const result = step(current, 1 / 60, supports, 1920);
    current = result.body;
    impact = Math.max(impact, result.impact);
  }
  return { body: current, impact };
}

test("a falling Nimbo lands on the first window top below it", () => {
  const { body, impact } = run({ x: 200, y: 0, vx: 0, vy: 0, ground: null }, 2);
  assert.equal(body.ground, 300);
  assert.equal(body.y, 300 - BUDDY_SIZE);
  assert.ok(impact > 0);
});

test("walking off the edge of a window makes him fall to the floor", () => {
  const { body } = run({ x: 480, y: 300 - BUDDY_SIZE, vx: 120, vy: 0, ground: 300 }, 3);
  assert.equal(body.ground, 1000);
});

test("he rides a window that moved a little", () => {
  const moved = supportsOf([{ left: 100, right: 500, top: 310 }], 1000, 1920);
  const { body } = step({ x: 200, y: 300 - BUDDY_SIZE, vx: 0, vy: 0, ground: 300 }, 1 / 60, moved, 1920);
  assert.equal(body.ground, 310);
});

test("thrown at a wall he bounces back", () => {
  const { body } = step({ x: 1900, y: 100, vx: 1500, vy: 0, ground: null }, 1 / 60, supports, 1920);
  assert.equal(body.x, 1920 - BUDDY_SIZE);
  assert.ok(body.vx < 0);
});

test("throw speed comes from the last pointer moves", () => {
  const velocity = throwVelocity([{ x: 0, y: 0, t: 0 }, { x: 50, y: -20, t: 50 }], 60);
  assert.equal(velocity.vx, 1000);
  assert.equal(velocity.vy, -400);
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, t: 0 }], 10), { vx: 0, vy: 0 });
  const next = follow({ x: 0, y: 0 }, { x: 100, y: 100 }, 1);
  assert.deepEqual(next, { x: 100, y: 100 });
});

test("the open app picks an outfit", () => {
  assert.equal(appAccessory("code.exe"), "glasses");
  assert.equal(appAccessory("spotify.exe"), "headphones");
  assert.equal(appAccessory("figma.exe"), "beret");
  assert.equal(appAccessory("explorer.exe"), null);
});
