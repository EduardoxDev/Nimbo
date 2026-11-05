import assert from "node:assert/strict";
import test from "node:test";
import { cleanMember, MAX_MEMBERS, MEMBER_TTL_MS, takePokes, upsertMember, validSquadCode } from "../relay/src/squad.ts";

const id = (n) => n.toString(16).padStart(16, "0");

test("codes are 8 easy-to-read characters", () => {
  assert.ok(validSquadCode("K7QM2PXA"));
  assert.ok(!validSquadCode("K7QM2PX0")); // 0 and O look alike
  assert.ok(!validSquadCode("k7qm2pxa"));
  assert.ok(!validSquadCode("K7QM2P"));
});

test("members are trimmed to what the island shows", () => {
  const member = cleanMember({ id: id(1), name: "  Ana\u0007  ", mood: "hack", focus: { status: "running", remainingMs: 9e12 }, distracted: "yes", extra: 1 }, 5);
  assert.deepEqual(member, { id: id(1), name: "Ana", mood: "idle", focus: { status: "running", remainingMs: 4 * 3_600_000 }, distracted: false, at: 5 });
  assert.equal(cleanMember({ id: "../../x" }, 5), null);
  assert.equal(cleanMember({ id: id(2) }, 5).name, "Nimbo");
});

test("the song a friend shares is cut to size", () => {
  const music = { title: "  Flores\u0007 ", artist: "Titãs", positionMs: -5, durationMs: 1e12, cover: "data:…" };
  assert.deepEqual(cleanMember({ id: id(3), music }, 5).music, { title: "Flores", artist: "Titãs", positionMs: 0, durationMs: 3 * 3_600_000 });
  assert.equal("music" in cleanMember({ id: id(3), music: { title: "" } }, 5), false);
});

test("quiet members leave, the group has a size limit", () => {
  const now = 10 * MEMBER_TTL_MS;
  const old = { ...cleanMember({ id: id(1), name: "Velho" }, now - MEMBER_TTL_MS - 1) };
  const ana = cleanMember({ id: id(2), name: "Ana" }, now);
  assert.deepEqual(upsertMember([old], ana, now).map((m) => m.name), ["Ana"]);
  const full = Array.from({ length: MAX_MEMBERS }, (_, n) => cleanMember({ id: id(n + 10), name: `P${n}` }, now));
  assert.equal(upsertMember(full, ana, now), null);
  assert.equal(upsertMember(full, { ...full[0], mood: "working" }, now).length, MAX_MEMBERS);
});

test("pokes are delivered once to the right person", () => {
  const pokes = [{ to: id(1), at: 100 }, { to: id(2), at: 100 }, { to: id(1), at: -1e9 }];
  const { mine, rest } = takePokes(pokes, id(1), 200);
  assert.equal(mine.length, 1);
  assert.deepEqual(rest.map((p) => p.to), [id(2)]);
});
