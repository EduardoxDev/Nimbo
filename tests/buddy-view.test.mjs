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
  assert.equal(fitsInView({ x: 900, y: 900 }, view), true);
  const corner = viewAround({ x: 0, y: 0 }, screen);
  assert.equal(corner.x, 0);
  assert.equal(corner.y, 0);
});

test("walking far enough asks for the window to move", () => {
  const view = viewAround({ x: 900, y: 900 }, screen);
  assert.equal(fitsInView({ x: 905, y: 900 }, view), true);
  assert.equal(fitsInView({ x: 1200, y: 900 }, view), false);
  assert.equal(fitsInView({ x: 900, y: 500 }, view), false);
});
