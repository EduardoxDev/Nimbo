import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadPercent } from "../src/updates/useUpdater.ts";

test("download progress is a whole percent, capped at 100", () => {
  assert.equal(downloadPercent(0, 1000), 0);
  assert.equal(downloadPercent(333, 1000), 33);
  assert.equal(downloadPercent(1200, 1000), 100);
});

test("download progress is unknown without a size", () => {
  assert.equal(downloadPercent(500, null), null);
  assert.equal(downloadPercent(500, 0), null);
});
