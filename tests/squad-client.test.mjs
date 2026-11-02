import assert from "node:assert/strict";
import test from "node:test";
import { friendMood, loadSquad, newMemberId, newSquadCode, normalizeSquadCode, prettyCode, startedFocusing } from "../src/squad/squad.ts";

test("codes are made, read back and shown nicely", () => {
  const code = newSquadCode();
  assert.equal(normalizeSquadCode(code), code);
  assert.equal(normalizeSquadCode(" k7qm-2pxa "), "K7QM2PXA");
  assert.equal(normalizeSquadCode("K7QM-2PX0"), null);
  assert.equal(normalizeSquadCode("curto"), null);
  assert.equal(prettyCode("K7QM2PXA"), "K7QM-2PXA");
  assert.match(newMemberId(), /^[a-f0-9]{16}$/);
});

test("the saved group survives bad storage", () => {
  const ok = { getItem: () => JSON.stringify({ code: "K7QM2PXA", name: "Edu", id: "0123456789abcdef" }) };
  assert.deepEqual(loadSquad(ok), { code: "K7QM2PXA", name: "Edu", id: "0123456789abcdef" });
  assert.equal(loadSquad({ getItem: () => "{oops" }), null);
  assert.equal(loadSquad({ getItem: () => JSON.stringify({ code: "x", id: "y" }) }), null);
});

const friend = (id, status, distracted = false) => ({ id, name: id, mood: "idle", focus: { status, remainingMs: 0 }, distracted });

test("only friends who just started focusing are announced", () => {
  const before = [friend("me", "idle"), friend("ana", "idle"), friend("bia", "running")];
  const after = [friend("me", "running"), friend("ana", "running"), friend("bia", "running"), friend("novo", "running")];
  assert.deepEqual(startedFocusing(before, after, "me").map((f) => f.id), ["ana"]);
});

test("a distracted friend looks embarrassed", () => {
  assert.equal(friendMood(friend("a", "running")), "working");
  assert.equal(friendMood(friend("a", "running", true)), "annoyed");
  assert.equal(friendMood({ ...friend("a", "idle"), mood: "sleeping" }), "sleeping");
});
