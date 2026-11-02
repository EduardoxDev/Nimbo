import assert from "node:assert/strict";
import test from "node:test";
import { calculate, smartLink, smartMatchOf } from "../src/clipboard/smart.ts";

test("copied things are recognised", () => {
  assert.equal(smartMatchOf("https://github.com/EduardoxDev/Nimbo")?.kind, "url");
  assert.equal(smartMatchOf("eduardo@example.com")?.kind, "email");
  assert.deepEqual(smartMatchOf("NB123456789BR"), { kind: "tracking", code: "NB123456789BR" });
  assert.deepEqual(smartMatchOf("(11) 98765-4321"), { kind: "phone", digits: "5511987654321" });
  assert.deepEqual(smartMatchOf("+55 21 3333-4444"), { kind: "phone", digits: "552133334444" });
  assert.equal(smartMatchOf("Rua Augusta, 1500 - São Paulo")?.kind, "address");
  assert.equal(smartMatchOf("CEP 01310-100")?.kind, "address");
  assert.deepEqual(smartMatchOf("#FF375F"), { kind: "color", hex: "#ff375f", rgb: "rgb(255, 55, 95)" });
  assert.deepEqual(smartMatchOf("12*3+4"), { kind: "math", expression: "12*3+4", result: "40" });
});

test("ordinary text gets no suggestion", () => {
  for (const text of ["Bom dia!", "12345678901", "abcdef", "2026", "reunião às 15h", "a-b", "-5"]) {
    assert.equal(smartMatchOf(text), null, text);
  }
});

test("the calculator understands Brazilian numbers and refuses code", () => {
  assert.equal(calculate("1.234,5 + 0,5"), "1235");
  assert.equal(calculate("(2+3)*4"), "20");
  assert.equal(calculate("10/4"), "2.5");
  assert.equal(calculate("2+"), null);
  assert.equal(calculate("alert(1)+1"), null);
  assert.equal(calculate("1/0"), null);
});

test("links are built only for https and mailto", () => {
  assert.equal(smartLink({ kind: "phone", digits: "5511987654321" }), "https://wa.me/5511987654321");
  assert.ok(smartLink({ kind: "address", query: "Rua A, 1" })?.startsWith("https://www.google.com/maps/"));
  assert.equal(smartLink({ kind: "color", hex: "#000000", rgb: "rgb(0, 0, 0)" }), null);
});
