import assert from "node:assert/strict";
import test from "node:test";
import { activeLyricIndex, formatTrackTime, lyricsQueryFor, parseLrc } from "../src/utils/lyrics.ts";

test("LRC parsing keeps timed lines in order and skips metadata", () => {
  const lines = parseLrc("[ar:Tulus]\n[00:12.50] Primeira\r\n[00:05.1]Antes\n[01:02.345][01:30.00] Refrão\n[00:20.00]\nsem tempo");
  assert.deepEqual(lines, [
    { timeMs: 5100, text: "Antes" },
    { timeMs: 12500, text: "Primeira" },
    { timeMs: 20000, text: "" },
    { timeMs: 62345, text: "Refrão" },
    { timeMs: 90000, text: "Refrão" },
  ]);
});

test("active line follows the playback position", () => {
  const lines = parseLrc("[00:05.00]a\n[00:10.00]b\n[00:15.00]c");
  assert.equal(activeLyricIndex(lines, 0), -1);
  assert.equal(activeLyricIndex(lines, 5000), 0);
  assert.equal(activeLyricIndex(lines, 14999), 1);
  assert.equal(activeLyricIndex(lines, 600000), 2);
  assert.equal(activeLyricIndex([], 1000), -1);
});

test("track times read like a player clock", () => {
  assert.equal(formatTrackTime(177400), "02:57");
  assert.equal(formatTrackTime(-5), "00:00");
  assert.equal(formatTrackTime(3_725_000), "1:02:05");
});

test("lyrics lookup splits Artist - Title when the player has no artist", () => {
  assert.deepEqual(lyricsQueryFor("Jatuh Suka", "Tulus"), { title: "Jatuh Suka", artist: "Tulus" });
  assert.deepEqual(lyricsQueryFor("Tulus - Jatuh Suka", null), { title: "Jatuh Suka", artist: "Tulus" });
  assert.deepEqual(lyricsQueryFor("Tulus – Jatuh Suka (Official Music Video)", ""), { title: "Jatuh Suka", artist: "Tulus" });
  assert.equal(lyricsQueryFor("Só o título", null), null);
});
