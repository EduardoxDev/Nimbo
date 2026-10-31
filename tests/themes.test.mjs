import assert from "node:assert/strict";
import test from "node:test";
import { exportTheme, parseTheme } from "../src/settings/themes.ts";

const theme = {
  appearanceMode: "liquidGlass",
  islandBackgroundColor: "#0F2A3D",
  pulseColor: "#5ac8fa",
  taskTextColor: "#ffffff",
  glassTint: 30,
  glassIntensity: 80,
  opacity: 95,
};

test("themes survive a copy and paste", () => {
  assert.deepEqual(parseTheme(exportTheme(theme)), theme);
});

test("bad or foreign text is not applied", () => {
  assert.equal(parseTheme("hello"), null);
  assert.equal(parseTheme(JSON.stringify(theme)), null);
  const unsafe = parseTheme(JSON.stringify({ nimboTheme: 1, pulseColor: "url(javascript:alert(1))", opacity: 10 }));
  assert.deepEqual(unsafe, { opacity: 50 });
});
