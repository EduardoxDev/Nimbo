import assert from "node:assert/strict";
import test from "node:test";
import { cardRequestOf, cardStopOf, cardText, crossed, findCard, isDue, loadCards, numberOf } from "../src/cards/cards.ts";

test("asking for a card and for removing it", () => {
  assert.equal(cardRequestOf("acompanha o dólar e me avisa se passar de 5,60"), "o dólar e me avisa se passar de 5,60");
  assert.equal(cardRequestOf("Ei Nimbo, fica de olho no bitcoin"), "bitcoin");
  assert.equal(cardRequestOf("track the euro"), "the euro");
  assert.equal(cardRequestOf("toca Anitta"), null);
  assert.equal(cardStopOf("para de acompanhar o dólar"), "dólar");
  assert.equal(cardStopOf("tira o cartão do bitcoin"), "bitcoin");
  const cards = [{ title: "Dólar" }, { title: "Bitcoin" }];
  assert.equal(findCard(cards, "dolar").title, "Dólar");
  assert.equal(findCard(cards, "euro"), null);
});

test("numbers, alerts and refresh", () => {
  assert.equal(numberOf("5.4210"), 5.421);
  assert.equal(numberOf("5,42"), 5.42);
  assert.equal(numberOf("358,123.4"), 358123.4);
  assert.equal(numberOf("2 × 1"), null);
  const card = { alert: { op: "above", value: 5.6 }, alerted: false };
  assert.deepEqual(crossed(card, "5.55"), { fire: false, alerted: false });
  assert.deepEqual(crossed(card, "5.61"), { fire: true, alerted: true });
  assert.deepEqual(crossed({ ...card, alerted: true }, "5.70"), { fire: false, alerted: true });
  assert.deepEqual(crossed({ ...card, alerted: true }, "5.50"), { fire: false, alerted: false });
  assert.equal(isDue({ updatedAt: 0, refreshMinutes: 15 }, 15 * 60_000), true);
  assert.equal(isDue({ updatedAt: 0, refreshMinutes: 15 }, 60_000), false);
});

test("what the island shows, and stored cards are checked", () => {
  const card = { title: "Dólar", prefix: "R$ ", unit: "", value: "5.4210", previous: "5.40" };
  assert.equal(cardText(card, "pt-BR"), "Dólar · R$ 5,42 ▲");
  assert.equal(cardText({ ...card, title: "Flamengo", prefix: "", value: "2 × 1", previous: null }, "pt-BR"), "Flamengo · 2 × 1");
  const stored = [{ id: "a", title: "x", url: "http://evil", path: "a" }, { id: "b", title: "Dólar", url: "https://x.com/a", path: "a.b", refreshMinutes: 1, alert: { op: "drop", value: 1 } }];
  const cards = loadCards({ getItem: () => JSON.stringify(stored) });
  assert.deepEqual(cards.map((item) => [item.id, item.refreshMinutes, item.alert]), [["b", 5, null]]);
});
