/**
 * Web Push (RFC 8291 encryption + RFC 8292 VAPID) with WebCrypto only: the
 * free way to put the island's notices on an iPhone lock screen, for the web
 * app added to the Home Screen (iOS 16.4+). No Apple account involved.
 */

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export type WebPushEnv = {
  /** Raw P-256 public key, base64url (65 bytes). Made by `npm run vapid`. */
  VAPID_PUBLIC_KEY?: string;
  /** PKCS#8 private key, base64url. A secret. */
  VAPID_PRIVATE_KEY?: string;
  /** Contact Apple and Google may use, e.g. mailto:you@example.com */
  VAPID_SUBJECT?: string;
};

/** Push services browsers use; anything else is refused (no requests to arbitrary hosts). */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function b64urlEncode(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function validSubscription(value: unknown): value is PushSubscription {
  const sub = value as PushSubscription;
  if (!sub || typeof sub.endpoint !== "string" || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") return false;
  try {
    const url = new URL(sub.endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname)) && b64urlDecode(sub.keys.p256dh).length === 65 && b64urlDecode(sub.keys.auth).length === 16;
  } catch {
    return false;
  }
}

export function webPushReady(env: WebPushEnv) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const text = (value: string) => new TextEncoder().encode(value);

async function hmac(key: Uint8Array, data: Uint8Array) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

/** aes128gcm body for one message, as RFC 8291 describes. */
export async function encrypt(payload: Uint8Array, subscription: PushSubscription, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const clientPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const localPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const clientKey = await crypto.subtle.importKey("raw", clientPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey } as unknown as Parameters<SubtleCrypto["deriveBits"]>[0], local.privateKey, 256));

  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(text("WebPush: info\0"), clientPublic, localPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(text("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(text("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // One record: the payload, then the 0x02 "last record" delimiter.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return concat(header, cipher);
}

async function vapidHeader(env: WebPushEnv, endpoint: string) {
  const key = await crypto.subtle.importKey("pkcs8", b64urlDecode(env.VAPID_PRIVATE_KEY ?? ""), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlEncode(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    text(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:nimbo@example.com" })),
  );
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Sends one notification. Returns false when the subscription is gone for good. */
export async function sendWebPush(env: WebPushEnv, subscription: PushSubscription, message: { title: string; body: string; tag?: string }): Promise<boolean> {
  if (!webPushReady(env) || !validSubscription(subscription)) return true;
  const body = await encrypt(text(JSON.stringify(message)), subscription);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidHeader(env, subscription.endpoint),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "600",
      urgency: "high",
    },
    body,
  });
  return response.status !== 404 && response.status !== 410;
}
