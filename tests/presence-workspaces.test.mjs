import assert from "node:assert/strict";
import test from "node:test";
import { liveCallOf, minutesSince, newDeviceUsers, prettyDevice } from "../src/life/presence.ts";
import { findWorkspace, parseWorkspaces, saveWorkspace, workspaceRequestOf } from "../src/workspaces/workspaces.ts";

const none = { microphone: [], camera: [] };

test("a calling app on the microphone is a call", () => {
  const call = liveCallOf({ microphone: [{ app: "MSTeams", since: 1000 }], camera: [] });
  assert.deepEqual(call, { id: "call-msteams-1000", app: "Teams", since: 1000 });
  assert.equal(liveCallOf({ microphone: [{ app: "WindowsSoundRecorder", since: 5 }], camera: [] }), null);
  // Any app with both the microphone and the camera counts too.
  assert.equal(liveCallOf({ microphone: [{ app: "Meetly", since: 5 }], camera: [{ app: "Meetly", since: 5 }] })?.app, "Meetly");
  assert.equal(liveCallOf(none), null);
});

test("new camera and microphone users are reported once", () => {
  const before = { microphone: [{ app: "Zoom", since: 1 }], camera: [] };
  const after = { microphone: [{ app: "Zoom", since: 1 }], camera: [{ app: "chrome", since: 2 }] };
  assert.deepEqual(newDeviceUsers(null, after), []);
  assert.deepEqual(newDeviceUsers(before, after), [{ device: "camera", app: "Chrome" }]);
  assert.deepEqual(newDeviceUsers(after, after), []);
  assert.equal(prettyDevice("WhatsAppDesktop"), "WhatsApp");
  assert.equal(minutesSince(0, 125_000), 2);
});

test("projects are asked for in three languages", () => {
  assert.deepEqual(workspaceRequestOf("salvar projeto Nimbo"), { kind: "save", name: "Nimbo" });
  assert.deepEqual(workspaceRequestOf("Abrir o projeto Nimbo Music"), { kind: "open", name: "Nimbo Music" });
  assert.deepEqual(workspaceRequestOf("voltar ao projeto TCC"), { kind: "open", name: "TCC" });
  assert.deepEqual(workspaceRequestOf("onde eu parei?"), { kind: "last" });
  assert.deepEqual(workspaceRequestOf("save project Thesis"), { kind: "save", name: "Thesis" });
  assert.deepEqual(workspaceRequestOf("where did I leave off"), { kind: "last" });
  assert.deepEqual(workspaceRequestOf("打开项目论文"), { kind: "open", name: "论文" });
  assert.equal(workspaceRequestOf("projeto"), null);
  assert.equal(workspaceRequestOf("chrome"), null);
});

test("projects are saved by name and found again", () => {
  const a = { id: "a", name: "Nimbo", savedAt: 1, apps: [], files: [] };
  const b = { id: "b", name: "TCC", savedAt: 2, apps: [{ name: "Word", path: "C:/w.exe" }], files: [] };
  let list = saveWorkspace(saveWorkspace([], a), b);
  assert.deepEqual(list.map((item) => item.id), ["b", "a"]);
  list = saveWorkspace(list, { ...a, id: "c", name: "nimbo" });
  assert.deepEqual(list.map((item) => item.id), ["c", "b"]);
  assert.equal(findWorkspace(list, "tcc")?.id, "b");
  assert.equal(findWorkspace(list, "nada"), null);
  assert.equal(parseWorkspaces("garbage").length, 0);
  assert.equal(parseWorkspaces(JSON.stringify([b, { bad: 1 }])).length, 1);
});
