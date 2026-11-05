import assert from "node:assert/strict";
import test from "node:test";
// mobile/ is not an ES module package, so its files load as CommonJS here.
import pairSwitch from "../mobile/src/pairSwitch.ts";

const { pairingHost, samePc } = pairSwitch;

const room = "a".repeat(32);
const key = "b".repeat(48);

test("a pairing link for another PC asks first, the same PC does not", () => {
  const mine = { relay: "https://nimbo.me.workers.dev", room, key, lan: "http://192.168.0.2:43900/?k=1" };
  assert.equal(samePc(mine, { ...mine, key: "c".repeat(48), lan: "http://192.168.0.9:43900/?k=2" }), true);
  assert.equal(samePc(mine, { ...mine, relay: "https://evil.example" }), false);
  assert.equal(samePc(mine, { ...mine, room: "d".repeat(32) }), false);
  const home = { relay: null, room: null, key: null, lan: "http://192.168.0.2:43900/?k=1" };
  assert.equal(samePc(home, { ...home, lan: "http://192.168.0.2:43900/?k=new" }), true);
  assert.equal(samePc(home, { ...home, lan: "http://10.0.0.5:43900/?k=1" }), false);
  assert.equal(pairingHost({ ...mine, relay: "https://evil.example" }), "evil.example");
});
