import assert from "node:assert/strict";
import test from "node:test";
import { TRANSLATIONS } from "../src/i18n/index.ts";
import { SETTINGS_GROUPS, normalize, searchSettings } from "../src/settings/search.ts";

const pt = TRANSLATIONS["pt-BR"];

test("every settings page sits in exactly one group", () => {
  const pages = SETTINGS_GROUPS.flatMap((group) => group.pages);
  assert.equal(new Set(pages).size, pages.length);
  assert.equal(pages.length, 17);
});

test("search finds pages by name, without accents or case", () => {
  assert.equal(normalize("  Água "), "agua");
  assert.equal(searchSettings(pt, "agua")[0], "water");
  assert.equal(searchSettings(pt, "POMODORO")[0], "pomodoro");
  assert.ok(searchSettings(pt, "celular").includes("phone"));
});

test("search looks inside the page and needs every word", () => {
  assert.ok(searchSettings(pt, "broadlink").includes("home"));
  assert.deepEqual(searchSettings(pt, "zzz-nada-aqui"), []);
  assert.deepEqual(searchSettings(pt, "   "), []);
});

test("search works in every language", () => {
  assert.equal(searchSettings(TRANSLATIONS.en, "water")[0], "water");
  assert.equal(searchSettings(TRANSLATIONS["zh-CN"], "番茄钟")[0], "pomodoro");
});
