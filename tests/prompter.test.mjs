import assert from "node:assert/strict";
import test from "node:test";
import { clampWpm, formatDuration, isPrompterRequest, loadPrompter, readingSeconds, scrollSpeed, wordCount } from "../src/prompter/prompter.ts";

test("reading time follows the words per minute", () => {
  const script = Array.from({ length: 280 }, () => "palavra").join(" ");
  assert.equal(wordCount(script), 280);
  assert.equal(readingSeconds(script, 140), 120);
  assert.equal(formatDuration(120), "2:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(scrollSpeed(2400, script, 140), 20);
  assert.equal(scrollSpeed(2400, "", 140), 0);
});

test("speed stays in a sensible range", () => {
  assert.equal(clampWpm(10), 80);
  assert.equal(clampWpm(999), 220);
  assert.equal(clampWpm(143), 145);
});

test("the saved script survives bad storage", () => {
  assert.equal(loadPrompter({ getItem: () => "{oops" }).wpm, 140);
  assert.deepEqual(loadPrompter({ getItem: () => JSON.stringify({ script: "oi", wpm: 500, fontSize: 2 }) }), { script: "oi", wpm: 220, fontSize: 16 });
});

test("the launcher opens it by name", () => {
  assert.ok(isPrompterRequest("Teleprompter"));
  assert.ok(isPrompterRequest(" roteiro "));
  assert.ok(!isPrompterRequest("roteiro de viagem"));
});
