import assert from "node:assert/strict";
import test from "node:test";
import { convertText, homeCurrency, parseAmount, ratesStale } from "../src/tools/convert.ts";
import { checkLink, checkText, registrableDomain, unconfuse } from "../src/tools/scam.ts";
import { addToPalette, cleanTrigger, colorName, diagnose, hexToRgb, hourIn, loadSnippets, momentOf } from "../src/tools/tools.ts";

const rates = { base: "EUR", date: "2026-11-02", rates: { USD: 1.1, BRL: 6.05, GBP: 0.85, JPY: 165, CNY: 7.9 } };
const now = new Date(Date.UTC(2026, 10, 2, 15, 0));

test("amounts are read in both number styles", () => {
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("1.500"), 1500);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount("abc"), null);
});

test("money becomes the user's own currency", () => {
  assert.equal(homeCurrency("pt-BR"), "BRL");
  const usd = convertText("120 USD", { rates, localeTag: "pt-BR", now });
  assert.equal(usd.to, "BRL");
  assert.match(usd.value, /R\$\s?660,00/);
  assert.equal(convertText("$ 10", { rates, localeTag: "pt-BR", now }).to, "BRL");
  assert.equal(convertText("€20", { rates, localeTag: "pt-BR", now }).to, "BRL");
  assert.equal(convertText("R$ 55", { rates, localeTag: "pt-BR", now }).to, "USD");
  assert.equal(convertText("120 USD", { rates: null, localeTag: "pt-BR", now }), null);
});

test("units and temperatures convert", () => {
  assert.equal(convertText("5 miles", { rates, localeTag: "pt-BR", now }).value, "8 km");
  assert.equal(convertText("350°F", { rates, localeTag: "pt-BR", now }).value, "177 °C");
  assert.equal(convertText("10 lbs", { rates, localeTag: "en", now }).value, "4.5 kg");
  assert.equal(convertText("6 ft", { rates, localeTag: "en", now }).value, "1.83 m");
});

test("a time in another zone becomes local time", () => {
  const result = convertText("3pm PST", { rates, localeTag: "pt-BR", now });
  assert.equal(result.to, "local");
  const expected = new Date(Date.UTC(2026, 10, 2, 23, 0)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  assert.ok(result.value.startsWith(expected), result.value);
});

test("plain text is left alone", () => {
  assert.equal(convertText("bom dia", { rates, localeTag: "pt-BR", now }), null);
  assert.equal(convertText("2026", { rates, localeTag: "pt-BR", now }), null);
  assert.equal(convertText("https://x.com", { rates, localeTag: "pt-BR", now }), null);
});

test("old rates are fetched again", () => {
  assert.ok(ratesStale(null, now));
  assert.ok(!ratesStale(rates, now));
  assert.ok(ratesStale({ ...rates, date: "2026-10-01" }, now));
});

test("look-alike and borrowed brand domains are dangerous", () => {
  assert.equal(registrableDomain("www.itau.com.br"), "itau.com.br");
  assert.equal(unconfuse("paypa1"), "paypal");
  assert.equal(checkLink("https://www.itau.com.br/conta"), null);
  assert.equal(checkLink("https://www.paypal.com/x"), null);
  const paypal = checkLink("https://paypa1.com/login");
  assert.equal(paypal.level, "danger");
  assert.equal(paypal.brand, "PayPal");
  const itau = checkLink("https://itau-seguro.xyz/atualizar");
  assert.equal(itau.level, "danger");
  assert.ok(itau.reasons.includes("riskyTld"));
  const ml = checkLink("https://mercadolivre.promo-black.com/oferta");
  assert.equal(ml.brand, "Mercado Livre");
  assert.equal(checkLink("https://nubank.com.br.app-seguro.top/").level, "danger");
});

test("hidden destinations only get a heads-up", () => {
  assert.equal(checkLink("https://bit.ly/abc").level, "warn");
  assert.equal(checkLink("https://github.com/EduardoxDev/Nimbo"), null);
  assert.equal(checkLink("https://192.168.0.1/").level, "warn");
  assert.equal(checkLink("https://xn--pypal-4ve.com/").level, "danger");
  assert.equal(checkLink("not a link"), null);
});

test("urgent Pix messages are flagged", () => {
  const message = "Seu Pix foi bloqueado, regularize urgente: https://bit.ly/x";
  const check = checkText(message);
  assert.equal(check.level, "danger");
  assert.ok(check.reasons.includes("pixUrgency"));
  assert.equal(checkText("Te mandei o Pix do almoço, valeu!"), null);
  assert.equal(checkText("Sua conta foi suspensa, entre agora").level, "warn");
});

test("colours get a name and a palette", () => {
  assert.deepEqual(hexToRgb("#1a2b3c"), { r: 26, g: 43, b: 60 });
  assert.equal(colorName("#0a7f80", "pt-BR"), "azul petróleo");
  assert.equal(colorName("#fe0101", "en"), "red");
  assert.deepEqual(addToPalette(["#aaaaaa", "#bbbbbb"], "#BBBBBB"), ["#bbbbbb", "#aaaaaa"]);
});

test("the checkup says what matters most", () => {
  const chrome = { name: "chrome", processes: 30, memoryMb: 5200, cpu: 45, canClose: true };
  assert.deepEqual(diagnose({ cpu: 90, memoryUsed: 92, memoryTotalGb: 8, diskFreeGb: 4, diskTotalGb: 256, uptimeHours: 200, apps: [chrome] }).map((f) => f.kind), ["cpu", "memory", "disk", "uptime"]);
  assert.deepEqual(diagnose({ cpu: 5, memoryUsed: 40, memoryTotalGb: 16, diskFreeGb: 200, diskTotalGb: 500, uptimeHours: 3, apps: [] }), [{ kind: "fine" }]);
});

test("friends' clocks know where it is night", () => {
  const tokyo = hourIn("Asia/Tokyo", now);
  assert.deepEqual(tokyo, { hour: 0, minute: 0 });
  assert.equal(momentOf(tokyo.hour), "sleeping");
  assert.equal(momentOf(8), "waking");
  assert.equal(momentOf(14), "working");
  assert.equal(momentOf(20), "evening");
  assert.equal(hourIn("Not/AZone", now), null);
});

test("snippet triggers always start with a semicolon", () => {
  assert.equal(cleanTrigger("email"), ";email");
  assert.equal(cleanTrigger(";;obg "), ";obg");
  assert.equal(cleanTrigger("   "), "");
  assert.deepEqual(loadSnippets('[{"trigger":";a","text":"b"},{"x":1}]'), [{ trigger: ";a", text: "b" }]);
});

import { toolCommandOf } from "../src/tools/tools.ts";

test("the launcher understands each tool by name", () => {
  assert.equal(toolCommandOf("fila"), "queue");
  assert.equal(toolCommandOf("desligar quando terminar"), "shutdown");
  assert.equal(toolCommandOf("Por que o PC tá lento?"), "doctor");
  assert.equal(toolCommandOf("chuva"), "sounds");
  assert.equal(toolCommandOf("jogar"), "game");
  assert.equal(toolCommandOf("conta-gotas"), "color");
  assert.equal(toolCommandOf("relógio dos amigos"), "friends");
  assert.equal(toolCommandOf("spotify"), null);
});
