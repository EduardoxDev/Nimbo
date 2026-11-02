import assert from "node:assert/strict";
import test from "node:test";
import { fitsInView, viewAround } from "../src/buddy/view.ts";

const screen = { width: 1920, height: 1080 };

test("the small window sits around Nimbo and stays on screen", () => {
  const view = viewAround({ x: 900, y: 900 }, screen);
  assert.equal(view.width, 460);
  assert.equal(view.height, 300);
  assert.ok(view.x <= 900 && view.x + view.width >= 956);
  assert.ok(view.y + view.height <= 1080);
  assert.equal(fitsInView({ x: 900, y: 900 }, view, screen), true);
  const corner = viewAround({ x: 0, y: 0 }, screen);
  assert.equal(corner.x, 0);
  assert.equal(corner.y, 0);
});

test("walking far enough asks for the window to move", () => {
  const view = viewAround({ x: 900, y: 900 }, screen);
  assert.equal(fitsInView({ x: 905, y: 900 }, view, screen), true);
  assert.equal(fitsInView({ x: 1200, y: 900 }, view, screen), false);
  assert.equal(fitsInView({ x: 900, y: 500 }, view, screen), false);
});

test("walking on the very bottom of the screen does not move the window every step", () => {
  const floorY = 1080 - 56;
  const view = viewAround({ x: 900, y: floorY }, screen);
  assert.equal(view.y + view.height, 1080);
  assert.equal(fitsInView({ x: 900, y: floorY }, view, screen), true);
  assert.equal(fitsInView({ x: 960, y: floorY }, view, screen), true);
  const corner = viewAround({ x: 1920 - 56, y: floorY }, screen);
  assert.equal(fitsInView({ x: 1920 - 56, y: floorY }, corner, screen), true);
});
