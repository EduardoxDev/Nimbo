import assert from "node:assert/strict";
import test from "node:test";
import { CODE_TTL_MS, codeFromSpeech, newCode, sameSecret, stillValid, validCode } from "../relay/src/alexa.ts";

test("pairing codes always have six digits", () => {
  assert.equal(newCode(new Uint8Array([0, 0, 7])), "000007");
  assert.equal(newCode(new Uint8Array([255, 255, 255])).length, 6);
  assert.equal(validCode("123456"), true);
  assert.equal(validCode("12345"), false);
  assert.equal(validCode(123456), false);
});

test("a code said to Alexa becomes the same six digits", () => {
  assert.equal(codeFromSpeech("482 113"), "482113");
  assert.equal(codeFromSpeech(42), "000042");
  assert.equal(codeFromSpeech("abc"), null);
  assert.equal(codeFromSpeech("1234567"), null);
});

test("only the skill's secret trades a code, and codes expire", () => {
  const secret = "s".repeat(32);
  assert.equal(sameSecret(secret, secret), true);
  assert.equal(sameSecret("x".repeat(32), secret), false);
  assert.equal(sameSecret(null, secret), false);
  assert.equal(sameSecret("short", "short"), false);
  assert.equal(sameSecret(secret, undefined), false);
  const now = 1_000_000;
  assert.equal(stillValid({ room: "r", key: "k", expiresAt: now + CODE_TTL_MS }, now), true);
  assert.equal(stillValid({ room: "r", key: "k", expiresAt: now - 1 }, now), false);
  assert.equal(stillValid(undefined, now), false);
});
