import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SHORTCUTS, normalizeShortcuts, shortcutFromEvent } from "../src/settings/shortcut.ts";

test("old default shortcuts move to the new default, custom ones stay", () => {
  assert.equal(normalizeShortcuts({ toggle: "Ctrl+Alt+Space" }).toggle, DEFAULT_SHORTCUTS.toggle);
  assert.equal(normalizeShortcuts({ toggle: "Ctrl+Shift+K" }).toggle, "Ctrl+Shift+K");
  assert.equal(normalizeShortcuts({ playPause: "" }).playPause, "");
  assert.deepEqual(normalizeShortcuts(null), DEFAULT_SHORTCUTS);
});

test("key presses become shortcut labels", () => {
  assert.equal(shortcutFromEvent({ key: " ", ctrlKey: false, altKey: true, shiftKey: true, metaKey: false }), "Alt+Shift+Space");
  assert.equal(shortcutFromEvent({ key: "k", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), "Ctrl+K");
  assert.equal(shortcutFromEvent({ key: "k", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }), null);
  assert.equal(shortcutFromEvent({ key: "Shift", ctrlKey: false, altKey: false, shiftKey: true, metaKey: false }), null);
});
