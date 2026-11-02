/**
 * Apple Push (APNs) for Live Activities: keeps the iPhone's island current
 * while the app is closed. Needs the .p8 key from the Apple Developer account
 * (secrets APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID); without them pushes are skipped.
 */

import type { ActivityState } from "./protocol";

export type ApnsEnv = {
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  /** "1" for development builds (Expo dev client, TestFlight uses production). */
  APNS_SANDBOX?: string;
};

let cached: { jwt: string; at: number } | null = null;

function base64url(bytes: Uint8Array | string) {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let text = "";
  for (const byte of raw) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function token(env: ApnsEnv) {
  // Apple accepts the same token for up to an hour.
  if (cached && Date.now() - cached.at < 50 * 60_000) return cached.jwt;
  const pem = (env.APNS_KEY ?? "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
  cached = { jwt, at: Date.now() };
  return jwt;
}

export function apnsReady(env: ApnsEnv) {
  return Boolean(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_BUNDLE_ID);
}

/** Updates (or ends) one Live Activity. Returns false when Apple says the token is gone. */
export async function pushActivity(env: ApnsEnv, deviceToken: string, state: ActivityState, end = false): Promise<boolean> {
  if (!apnsReady(env) || !/^[a-f0-9]{16,200}$/i.test(deviceToken)) return true;
  const host = env.APNS_SANDBOX === "1" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await token(env)}`,
      "apns-topic": `${env.APNS_BUNDLE_ID}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
    },
    body: JSON.stringify({
      aps: {
        timestamp: Math.floor(Date.now() / 1000),
        event: end ? "end" : "update",
        "content-state": state,
        ...(end ? { "dismissal-date": Math.floor(Date.now() / 1000) } : {}),
      },
    }),
  });
  return response.status !== 410 && response.status !== 400;
}
