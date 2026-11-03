import assert from "node:assert/strict";
import test from "node:test";
import { buildItems, groupByDay, parseQuery, search } from "../src/memory/memory.ts";

const NOW = new Date(2026, 10, 3, 18, 0);
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

const days = [
  {
    segments: [
      { app: "chrome.exe", title: "Rust ownership explained - DEV Community - Google Chrome", start: at(2, 10), end: at(2, 10, 20) },
      { app: "chrome.exe", title: "Rust ownership explained - DEV Community - Google Chrome", start: at(2, 10, 21), end: at(2, 10, 30) },
      { app: "code.exe", title: "App.tsx - nimbo - Visual Studio Code", start: at(2, 15, 0), end: at(2, 16, 0) },
      { app: "explorer.exe", title: "Downloads", start: at(2, 16, 0), end: at(2, 16, 5) },
      { app: "ms-teams.exe", title: "Reunião de planejamento | Microsoft Teams", start: at(3, 11, 0), end: at(3, 11, 40) },
    ],
  },
];
const files = [
  { path: "C:\\Users\\voce\\Downloads\\contrato-marco.pdf", name: "contrato-marco.pdf", folder: false, at: at(2, 16, 10) },
  { path: "C:\\Users\\voce\\Documents\\orcamento.xlsx", name: "orcamento.xlsx", folder: false, at: at(3, 9, 0) },
];
const copies = [
  { id: "1", text: "https://github.com/EduardoxDev/Nimbo", copiedAt: at(3, 12, 0) },
  { id: "2", text: "senha não fica aqui", copiedAt: at(1, 12, 0) },
];

const items = buildItems(days, files, copies);

test("joins repeated window samples and skips the Windows shell", () => {
  const windows = items.filter((item) => item.kind === "window");
  assert.equal(windows.length, 3);
  const rust = windows.find((item) => item.title.startsWith("Rust ownership"));
  assert.equal(rust.title, "Rust ownership explained - DEV Community");
  assert.equal(rust.end, at(2, 10, 30));
  assert.ok(!windows.some((item) => item.app === "explorer.exe"));
  assert.ok(windows.some((item) => item.title === "App.tsx - nimbo"));
  assert.ok(windows.some((item) => item.title === "Reunião de planejamento"));
  assert.equal(items.find((item) => item.kind === "copy" && item.url)?.url, "https://github.com/EduardoxDev/Nimbo");
});

test("understands days, weekdays and times of day in Portuguese", () => {
  const yesterday = parseQuery("aquele link sobre rust que eu vi ontem", NOW);
  assert.deepEqual(yesterday.words, ["rust"]);
  assert.equal(yesterday.from, at(2, 0));
  assert.equal(yesterday.links, true);
  const afternoon = parseQuery("o que eu estava fazendo ontem às 15h", NOW);
  assert.deepEqual(afternoon.words, []);
  assert.equal(afternoon.from, at(2, 14, 15));
  assert.equal(afternoon.to, at(2, 15, 45));
  const monday = parseQuery("pdf de segunda", NOW);
  assert.deepEqual(monday.kinds, ["file"]);
  assert.ok(monday.extensions.includes("pdf"));
  assert.equal(monday.from, at(2, 0));
  const morning = parseQuery("planilha hoje de manhã", NOW);
  assert.equal(morning.from, at(3, 5));
  assert.equal(morning.to, at(3, 12));
});

test("finds the right thing for natural questions", () => {
  assert.equal(search(items, parseQuery("aquele link sobre rust que eu vi ontem", NOW))[0].title, "Rust ownership explained - DEV Community");
  assert.equal(search(items, parseQuery("o que eu estava fazendo ontem às 15h", NOW))[0].subtitle, "VS Code");
  assert.equal(search(items, parseQuery("o pdf do contrato", NOW))[0].title, "contrato-marco.pdf");
  assert.equal(search(items, parseQuery("planilha hoje de manhã", NOW))[0].title, "orcamento.xlsx");
  assert.equal(search(items, parseQuery("link que copiei hoje", NOW))[0].url, "https://github.com/EduardoxDev/Nimbo");
  assert.equal(search(items, parseQuery("reunião de planejamento", NOW))[0].kind, "window");
  assert.deepEqual(search(items, parseQuery("algo que nunca existiu", NOW)), []);
});

test("key and secret files never show up", () => {
  const secretFiles = ["nimbo-updater.key", "server.pem", ".env", ".env.local", "id_ed25519", "cofre.kdbx", "credentials.json"].map((name, index) => ({ path: `C:/Users/voce/${name}`, name, folder: false, at: at(3, 8, index) }));
  const kept = buildItems([], [...secretFiles, { path: "C:/Users/voce/notas.md", name: "notas.md", folder: false, at: at(3, 9) }], []);
  assert.deepEqual(kept.map((item) => item.title), ["notas.md"]);
});

test("results group by day, newest first", () => {
  const groups = groupByDay(search(items, parseQuery("", NOW)));
  assert.deepEqual(groups.map((group) => new Date(group.day).getDate()), [3, 2, 1]);
});
