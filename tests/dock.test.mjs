import assert from "node:assert/strict";
import test from "node:test";
import { dockItems, dockSize, magnification, nameOf, readDockSettings, togglePin } from "../src/dock/dock.ts";

test("pinned apps come first and running ones join them once", () => {
  const running = [
    { path: "C:/Apps/Code.exe", name: "VS Code", windows: [{ id: 1, title: "nimbo", minimized: false }], active: true },
    { path: "C:/Apps/chrome.exe", name: "Chrome", windows: [{ id: 2, title: "Google", minimized: false }], active: false },
  ];
  const items = dockItems(["c:/apps/code.exe", "C:/Apps/spotify.exe"], running);
  assert.deepEqual(items.map((item) => item.name), ["VS Code", "Spotify", "Chrome"]);
  assert.equal(items[0].pinned, true);
  assert.equal(items[0].active, true);
  assert.equal(items[1].windows.length, 0);
  assert.equal(items[2].pinned, false);
});

test("pinning toggles and settings are read safely", () => {
  assert.deepEqual(togglePin(["A.exe"], "a.exe"), []);
  assert.deepEqual(togglePin([], "B.exe"), ["B.exe"]);
  assert.deepEqual(readDockSettings("{"), { pinned: [], iconSize: 48, magnify: true });
  assert.equal(readDockSettings(JSON.stringify({ dockIconSize: 200 })).iconSize, 72);
  assert.equal(nameOf("C:/x/figma.exe"), "Figma");
});

test("icons grow near the pointer and the bar fits them", () => {
  const slot = 56;
  assert.equal(magnification(0, null, slot, true), 1);
  assert.ok(magnification(2, 2 * slot + slot / 2, slot, true) > 1.55);
  assert.ok(magnification(3, 2 * slot + slot / 2, slot, true) < magnification(2, 2 * slot + slot / 2, slot, true));
  assert.equal(magnification(8, 0, slot, true), 1);
  assert.equal(magnification(2, 2 * slot, slot, false), 1);
  const size = dockSize(5, 48);
  assert.equal(size.slot, 56);
  assert.ok(size.width > 6 * 56);
});
