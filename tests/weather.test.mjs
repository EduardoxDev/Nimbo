import assert from "node:assert/strict";
import test from "node:test";
import { weatherKind } from "../src/weather/weather.ts";

test("weather codes map to readable kinds", () => {
  assert.equal(weatherKind(0), "clear");
  assert.equal(weatherKind(2), "partly");
  assert.equal(weatherKind(45), "fog");
  assert.equal(weatherKind(53), "drizzle");
  assert.equal(weatherKind(81), "rain");
  assert.equal(weatherKind(73), "snow");
  assert.equal(weatherKind(96), "storm");
});
