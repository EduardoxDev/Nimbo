import assert from "node:assert/strict";
import test from "node:test";
import { mascotFrame } from "../src/mascot/engine.ts";
import { domName, flatten, mascotNodes, shapeOf } from "../src/mascot/mascotNodes.ts";

const paint = { color: "#5ac8fa", light: "#fff", shade: "#333", accent: "#5ac8fa", ids: { body: "b", bulb: "u", glow: "g", clip: "c" } };
const nodesAt = (mood, t, extra = {}) =>
  mascotNodes(mascotFrame({ shape: "cloud", mood, t, seed: 7, gaze: null, poke: null }), { detail: true, paint, aura: null, glow: true, showDot: true, mood, time: t, ...extra });
const shape = (nodes) => `${shapeOf(nodes.before)}|${shapeOf(nodes.body)}|${shapeOf(nodes.after)}`;

test("the drawing keeps its pieces while it moves, so frames only patch numbers", () => {
  const first = nodesAt("working", 1);
  const later = nodesAt("working", 1.05);
  assert.equal(shape(first), shape(later));
  assert.notEqual(first.transform + first.clip, later.transform + later.clip);
});

test("changing mood can change the pieces, which asks React to redraw", () => {
  assert.notEqual(shape(nodesAt("idle", 1)), shape(nodesAt("sleeping", 1)));
});

test("every piece has a unique key and attributes map to SVG names", () => {
  const nodes = nodesAt("greeting", 2, { aura: "wings" });
  const keys = flatten([...nodes.before, ...nodes.body, ...nodes.after]).map((node) => node.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(domName("strokeWidth"), "stroke-width");
  assert.equal(domName("fillOpacity"), "fill-opacity");
  assert.equal(domName("clipPath"), "clip-path");
  assert.equal(domName("className"), "class");
  assert.equal(domName("d"), "d");
});
