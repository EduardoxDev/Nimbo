import assert from "node:assert/strict";
import test from "node:test";
import { freshHandoff, handoffOf, HANDOFF_TTL_MS, musicLink, wentAway } from "../src/phone/handoff.ts";

test("a page with its address wins over the music", () => {
  const handoff = handoffOf({ app: "Chrome", title: "Rust ownership explained", url: "https://dev.to/rust" }, { title: "Céu de Setembro", artist: "Lia Moraes", playing: true }, 10);
  assert.deepEqual(handoff, { kind: "page", title: "Rust ownership explained", subtitle: "Chrome", url: "https://dev.to/rust", at: 10 });
});

test("without a page, a song that is playing is handed off with a search link", () => {
  const handoff = handoffOf({ app: "VS Code", title: "App.tsx" }, { title: "Céu de Setembro", artist: "Lia Moraes", playing: true }, 10);
  assert.equal(handoff.kind, "music");
  assert.equal(handoff.url, "https://open.spotify.com/search/C%C3%A9u%20de%20Setembro%20Lia%20Moraes");
  assert.equal(handoffOf({ app: "VS Code", title: "App.tsx" }, { title: "x", artist: null, playing: false }, 10), null);
  assert.equal(handoffOf(null, null, 10), null);
  assert.equal(musicLink("Song", null), "https://open.spotify.com/search/Song");
});

test("going away is the moment idle crosses three minutes", () => {
  assert.equal(wentAway(30, 200), true);
  assert.equal(wentAway(200, 260), false);
  assert.equal(wentAway(10, 60), false);
});

test("a handoff is only offered for a few hours", () => {
  const handoff = { kind: "page", title: "x", subtitle: "Chrome", url: "https://a.com", at: 1000 };
  assert.equal(freshHandoff(handoff, 1000 + HANDOFF_TTL_MS), handoff);
  assert.equal(freshHandoff(handoff, 1001 + HANDOFF_TTL_MS), null);
  assert.equal(freshHandoff(null, 0), null);
});
