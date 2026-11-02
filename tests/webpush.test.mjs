import assert from "node:assert/strict";
import test from "node:test";
import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { encrypt, validSubscription } from "../relay/src/webpush.ts";

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** The phone's side of RFC 8291, written with Node's own crypto (independent of the relay). */
function decrypt(body, clientEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const cipher = body.subarray(21 + idLength);
  const shared = clientEcdh.computeSecret(serverPublic);
  const clientPublic = clientEcdh.getPublicKey();
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, cipher.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

test("web notifications decrypt on the phone side", async () => {
  const clientEcdh = createECDH("prime256v1");
  clientEcdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: b64url(clientEcdh.getPublicKey()), auth: b64url(auth) } };
  const message = JSON.stringify({ title: "Seu PC", body: "Reunião em 5 min" });
  const body = Buffer.from(await encrypt(new TextEncoder().encode(message), subscription));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, clientEcdh, auth), message);
});

test("only real push services are accepted", () => {
  const keys = { p256dh: b64url(Buffer.alloc(65, 4)), auth: b64url(Buffer.alloc(16, 1)) };
  assert.equal(validSubscription({ endpoint: "https://web.push.apple.com/x", keys }), true);
  assert.equal(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }), true);
  assert.equal(validSubscription({ endpoint: "https://evil.example.com/x", keys }), false);
  assert.equal(validSubscription({ endpoint: "http://web.push.apple.com/x", keys }), false);
  assert.equal(validSubscription({ endpoint: "https://web.push.apple.com/x", keys: { ...keys, auth: "x" } }), false);
});
