import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_LIVE, formatBytes, liveSummary } from "../src/live/live.ts";

const copy = { copying: (p) => `Copiando ${p}%`, downloading: (n, d) => `Baixando ${n} · ${d}`, more: (c) => `+${c}` };

test("sizes read like a person would say them", () => {
  assert.equal(formatBytes(512, "en"), "512 B");
  assert.equal(formatBytes(1536, "en"), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024, "pt-BR"), "5,0 MB");
  assert.equal(formatBytes(300 * 1024 * 1024, "en"), "300 MB");
});

test("nothing running shows nothing", () => {
  assert.equal(liveSummary(EMPTY_LIVE, copy, "en"), null);
});

test("a copy shows its percent and wins over downloads", () => {
  const state = { copies: [{ percent: 40, title: "" }], downloads: [{ id: "a", name: "x.zip", bytes: 1, speed: 1 }] };
  assert.deepEqual(liveSummary(state, copy, "en"), { text: "Copiando 40% +1", progress: 0.4 });
});

test("the fastest download is the one named", () => {
  const state = {
    copies: [],
    downloads: [
      { id: "a", name: "lento.zip", bytes: 10, speed: 100 },
      { id: "b", name: "rapido.iso", bytes: 10, speed: 2 * 1024 * 1024 },
    ],
  };
  assert.deepEqual(liveSummary(state, copy, "en"), { text: "Baixando rapido.iso · 2.0 MB/s +1", progress: null });
});
