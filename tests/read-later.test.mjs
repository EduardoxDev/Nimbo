import assert from "node:assert/strict";
import test from "node:test";
import { addReadLater, markRead, readLaterDue, readLaterRequestOf, shortLink, unread } from "../src/readLater/readLater.ts";

test("the launcher understands read-later requests in every language", () => {
  assert.equal(readLaterRequestOf("ler depois https://a.com/x"), "https://a.com/x");
  assert.equal(readLaterRequestOf("read later https://a.com"), "https://a.com");
  assert.equal(readLaterRequestOf("稍后读 https://a.com"), "https://a.com");
  assert.equal(readLaterRequestOf("https://a.com/b"), "https://a.com/b");
  assert.equal(readLaterRequestOf("ler depois banana"), null);
  assert.equal(readLaterRequestOf("spotify"), null);
});

test("saving keeps one copy per link, newest first, and reading marks it", () => {
  let items = addReadLater([], "https://a.com", 1);
  items = addReadLater(items, "https://b.com", 2);
  items = addReadLater(items, "https://a.com", 3);
  assert.deepEqual(items.map((item) => item.url), ["https://a.com", "https://b.com"]);
  assert.equal(addReadLater(items, "not a link", 4), items);
  items = markRead(items, items[0].id, 5);
  assert.deepEqual(unread(items).map((item) => item.url), ["https://b.com"]);
});

test("links come back only in a free moment, rarely", () => {
  const noon = new Date(2026, 10, 2, 12, 0).getTime();
  const items = addReadLater([], "https://a.com", noon - 60 * 60 * 1000);
  assert.equal(readLaterDue(items, { now: noon, lastRemindedAt: 0, busy: false })?.url, "https://a.com");
  assert.equal(readLaterDue(items, { now: noon, lastRemindedAt: 0, busy: true }), null);
  assert.equal(readLaterDue(items, { now: noon, lastRemindedAt: noon - 60_000, busy: false }), null);
  const night = new Date(2026, 10, 2, 23, 30).getTime();
  assert.equal(readLaterDue(items, { now: night, lastRemindedAt: 0, busy: false }), null);
  const fresh = addReadLater([], "https://b.com", noon - 60_000);
  assert.equal(readLaterDue(fresh, { now: noon, lastRemindedAt: 0, busy: false }), null);
});

test("links are shown short", () => {
  assert.equal(shortLink("https://www.github.com/EduardoxDev/Nimbo/"), "github.com/EduardoxDev/Nimbo");
});
