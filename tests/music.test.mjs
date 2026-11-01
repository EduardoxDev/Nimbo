import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, EQ_LIMIT, normalizeSettings, rgbOf } from "../src/music/settings.ts";
import { formatDuration, toggleLike, withRecent, yearOf } from "../src/music/catalog.ts";
import { addToPlaylist, createPlaylist, mosaicOf, moveInPlaylist, playRequestOf, removeFromPlaylist } from "../src/music/library.ts";

const track = (id) => ({ id, title: `Song ${id}`, duration: 200, preview: null, explicit: false, artistId: 1, artistName: "A", albumId: 1, albumTitle: "B", cover: null, coverXl: null });

test("stored music settings fall back field by field", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const mixed = normalizeSettings({ accent: "blue", speed: 3, fade: 4, service: "napster", eqGains: [99, -99, 0, "x", 2] });
  assert.equal(mixed.accent, "blue");
  assert.equal(mixed.speed, DEFAULT_SETTINGS.speed);
  assert.equal(mixed.fade, 4);
  assert.equal(mixed.service, DEFAULT_SETTINGS.service);
  assert.deepEqual(mixed.eqGains, [EQ_LIMIT, -EQ_LIMIT, 0, 0, 2]);
});

test("accent colours convert to rgb triplets", () => {
  assert.equal(rgbOf("#ff375f"), "255, 55, 95");
});

test("likes toggle and recent keeps the newest first without repeats", () => {
  const liked = toggleLike([], track(1));
  assert.equal(liked.length, 1);
  assert.equal(toggleLike(liked, track(1)).length, 0);
  const recent = withRecent([track(1), track(2)], track(2));
  assert.deepEqual(recent.map((item) => item.id), [2, 1]);
});

test("durations and years read well", () => {
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(yearOf("2026-03-01"), "2026");
  assert.equal(yearOf(null), null);
});

test("spoken play requests become catalog searches", () => {
  assert.equal(playRequestOf("toca Anitta"), "Anitta");
  assert.equal(playRequestOf("Ei Nimbo, toca a música Flash do Hugo"), "Flash do Hugo");
  assert.equal(playRequestOf("coloca Daft Punk."), "Daft Punk");
  assert.equal(playRequestOf("play One More Time"), "One More Time");
  // The old media controls and normal chat stay with the assistant.
  assert.equal(playRequestOf("toca a próxima"), null);
  assert.equal(playRequestOf("liga o ar em 22"), null);
});

test("playlists add once, remove and reorder", () => {
  let lists = createPlaylist([], "  Treino  ", track(1));
  const id = lists[0].id;
  assert.equal(lists[0].name, "Treino");
  lists = addToPlaylist(lists, id, track(2));
  lists = addToPlaylist(lists, id, track(2));
  assert.deepEqual(lists[0].tracks.map((item) => item.id), [1, 2]);
  lists = moveInPlaylist(lists, id, 1, 0);
  assert.deepEqual(lists[0].tracks.map((item) => item.id), [2, 1]);
  lists = removeFromPlaylist(lists, id, 2);
  assert.deepEqual(lists[0].tracks.map((item) => item.id), [1]);
});

test("the playlist mosaic uses up to four different covers", () => {
  const covered = [1, 2, 2, 3, 4, 5].map((id) => ({ ...track(id), cover: `c${id}.jpg` }));
  assert.deepEqual(mosaicOf(covered), ["c1.jpg", "c2.jpg", "c3.jpg", "c4.jpg"]);
});
