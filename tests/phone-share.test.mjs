import assert from "node:assert/strict";
import test from "node:test";
import { activityOfWindow, latestCopiedText } from "../src/phone/share.ts";

test("the phone gets the newest copied text, never an image", () => {
  const items = [
    { kind: "text", text: "velho", copiedAt: 1 },
    { kind: "image", copiedAt: 9 },
    { kind: "text", text: "novo", copiedAt: 5 },
  ];
  assert.deepEqual(latestCopiedText(items), { text: "novo", copiedAt: 5 });
  assert.equal(latestCopiedText([]), null);
  assert.equal(latestCopiedText([{ kind: "text", text: "x".repeat(5000), copiedAt: 1 }]).text.length, 2000);
});

test("windows become a friendly app and a clean title", () => {
  assert.deepEqual(activityOfWindow("chrome.exe", "Nimbo - GitHub - Google Chrome"), { app: "Chrome", title: "Nimbo - GitHub" });
  assert.deepEqual(activityOfWindow("Code.exe", "App.tsx - nimbo - Visual Studio Code"), { app: "VS Code", title: "App.tsx - nimbo" });
  assert.deepEqual(activityOfWindow("vlc.exe", "filme.mp4"), { app: "vlc", title: "filme.mp4" });
  assert.equal(activityOfWindow("nimbo.exe", "Nimbo"), null);
});
