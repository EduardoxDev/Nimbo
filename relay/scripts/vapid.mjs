// Makes the key pair for free web notifications (Web Push). Run once: npm run vapid
import { webcrypto } from "node:crypto";

const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = b64url(new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)));

console.log("Chave pública (pode ficar no wrangler.toml, em [vars]):");
console.log(`VAPID_PUBLIC_KEY = "${publicKey}"\n`);
console.log("Chave privada: guarde como segredo, NUNCA no Git. Rode:");
console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
console.log("e cole:");
console.log(privateKey);
