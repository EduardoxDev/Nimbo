import assert from "node:assert/strict";
import test from "node:test";
import { searchApps } from "../src/launcher/launcher.ts";

const apps = ["Calculadora", "Configurações", "Visual Studio Code", "Word", "WhatsApp", "Explorador de Arquivos"].map((name) => ({
  name,
  id: name,
}));

test("prefix matches come first and accents are ignored", () => {
  assert.equal(searchApps(apps, "conf")[0].name, "Configurações");
  assert.equal(searchApps(apps, "configuracoes")[0].name, "Configurações");
  assert.equal(searchApps(apps, "code")[0].name, "Visual Studio Code");
  assert.deepEqual(searchApps(apps, "w").map((app) => app.name), ["Word", "WhatsApp"]);
});

test("loose letters still find apps and empty queries return nothing", () => {
  assert.equal(searchApps(apps, "vsc")[0].name, "Visual Studio Code");
  assert.deepEqual(searchApps(apps, "  "), []);
  assert.deepEqual(searchApps(apps, "zzz"), []);
});
