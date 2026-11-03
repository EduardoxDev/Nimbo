import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_KINDS, actionReady, defaultAction, defaultTrigger, RECIPES, ruleFromParts, TRIGGER_COLORS, TRIGGER_KINDS, triggerReady } from "../src/automations/catalog.ts";
import { actionsOf, parseRules } from "../src/rules/rules.ts";
import ptBR from "../src/i18n/locales/pt-BR.ts";
import en from "../src/i18n/locales/en.ts";
import zhCN from "../src/i18n/locales/zh-CN.ts";

test("every trigger kind has a colour and a default that is shaped right", () => {
  for (const kind of TRIGGER_KINDS) {
    assert.ok(TRIGGER_COLORS[kind], kind);
    assert.equal(defaultTrigger(kind).kind, kind);
  }
  assert.equal(triggerReady(defaultTrigger("time")), true);
  assert.equal(triggerReady(defaultTrigger("wifi")), false);
  assert.equal(triggerReady({ kind: "wifi", ssid: "Casa" }), true);
  assert.equal(triggerReady({ kind: "time", time: "9h" }), false);
});

test("actions that need text are not ready until filled", () => {
  for (const kind of ACTION_KINDS) assert.equal(defaultAction(kind).kind, kind);
  assert.equal(actionReady(defaultAction("say")), false);
  assert.equal(actionReady({ kind: "say", text: "Oi" }), true);
  assert.equal(actionReady(defaultAction("pause")), true);
  assert.equal(actionReady({ kind: "url", url: "a" }), false);
});

test("recipes build rules that survive storage with all their actions", () => {
  const rules = RECIPES.map((recipe, index) => ({ ...ruleFromParts(recipe.trigger, recipe.actions, recipe.id, "Receita"), id: String(index), enabled: true }));
  const stored = parseRules(JSON.stringify(rules));
  assert.equal(stored.length, RECIPES.length);
  for (const [index, rule] of stored.entries()) {
    assert.deepEqual(actionsOf(rule), RECIPES[index].actions);
    assert.deepEqual(rule.action, RECIPES[index].actions[0]);
    assert.ok(triggerReady(rule.trigger) && actionsOf(rule).every(actionReady), rule.text);
  }
});

test("every locale names every trigger, action and weekday", () => {
  for (const locale of [ptBR, en, zhCN]) {
    const copy = locale.automations;
    for (const kind of TRIGGER_KINDS) assert.ok(copy.triggers[kind], kind);
    for (const kind of ACTION_KINDS) assert.ok(copy.actions[kind], kind);
    assert.equal(copy.weekdays.length, 7);
    assert.match(copy.testing("x"), /x/);
  }
});
