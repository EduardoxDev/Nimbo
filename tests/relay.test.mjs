import assert from "node:assert/strict";
import test from "node:test";
import { activityOf, hashKey, shouldPush, validKey, validRoom } from "../relay/src/protocol.ts";

test("rooms and codes have one shape", () => {
  assert.equal(validRoom("0123456789abcdef0123456789abcdef"), true);
  assert.equal(validRoom("../etc"), false);
  assert.equal(validKey("a".repeat(48)), true);
  assert.equal(validKey("a".repeat(47)), false);
});

test("codes are stored hashed", async () => {
  const hash = await hashKey("a".repeat(48));
  assert.equal(hash.length, 64);
  assert.notEqual(hash, "a".repeat(48));
  assert.equal(hash, await hashKey("a".repeat(48)));
});

test("the iPhone island shows focus, then notices, then music", () => {
  const now = 1_000_000;
  const music = { title: "Song", artist: "Artist", playing: true, positionMs: 30_000, durationMs: 120_000 };
  const running = activityOf({ focus: { status: "running", phase: "focus", remainingMs: 600_000, totalMs: 1_500_000 }, music }, now);
  assert.equal(running.kind, "focus");
  assert.equal(running.endsAt, now + 600_000);
  assert.equal(Math.round(running.progress * 100), 60);
  assert.equal(activityOf({ island: { text: "Reunião em 5 min", color: "#ff6961" }, music }, now).kind, "notice");
  const playing = activityOf({ music }, now);
  assert.deepEqual([playing.kind, playing.title, playing.progress], ["music", "Song", 0.25]);
  assert.equal(activityOf(null, now).kind, "idle");
});

test("pushes only when the island really changes", () => {
  const a = activityOf({ music: { title: "A", artist: "x", playing: true, positionMs: 0, durationMs: 1 } }, 0);
  const b = activityOf({ music: { title: "B", artist: "x", playing: true, positionMs: 0, durationMs: 1 } }, 0);
  assert.equal(shouldPush(null, a, 0, 20_000), true);
  assert.equal(shouldPush(a, a, 0, 20_000), false);
  assert.equal(shouldPush(a, b, 0, 20_000), true);
  assert.equal(shouldPush(a, b, 15_000, 20_000), false);
});

test("the iPhone app uses the same island rules as the relay", async () => {
  const { readFileSync } = await import("node:fs");
  const relay = readFileSync(new URL("../relay/src/protocol.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../mobile/src/shared/protocol.ts", import.meta.url), "utf8");
  assert.equal(app.slice(app.indexOf("\n") + 1), relay);
});
