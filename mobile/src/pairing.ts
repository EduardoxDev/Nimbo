import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/** What the QR code in the PC's Settings → Celular carries. */
export type Pairing = { relay: string | null; room: string | null; key: string | null; lan: string | null };

const STORE_KEY = "nimbo-pairing";

function fromParams(params: URLSearchParams): Pairing | null {
  const relay = params.get("relay");
  const room = params.get("room");
  const key = params.get("key");
  const lan = params.get("lan");
  const relayOk = !!relay && /^https?:\/\//.test(relay) && !!room && /^[a-f0-9]{32}$/.test(room) && !!key && /^[a-f0-9]{48}$/.test(key);
  if (!relayOk && !lan) return null;
  return { relay: relayOk ? relay : null, room: relayOk ? room : null, key: relayOk ? key : null, lan: lan || null };
}

/**
 * https://<relay>/pair#relay=…&room=…&key=…&lan=… (the QR code), the older
 * nimbo://pair?…, or a plain home-Wi-Fi link http://192.168.x.x:43900/?k=…
 */
export function parsePairing(text: string): Pairing | null {
  const value = text.trim();
  try {
    const url = new URL(value);
    if (url.protocol === "nimbo:") return fromParams(url.searchParams);
    if (/^https?:$/.test(url.protocol) && url.pathname.replace(/\/$/, "").endsWith("/pair") && url.hash.length > 1) {
      return fromParams(new URLSearchParams(url.hash.slice(1)));
    }
    if (url.protocol === "http:" && url.searchParams.get("k")) return { relay: null, room: null, key: null, lan: value };
  } catch {
    return null;
  }
  return null;
}

// The web app has no Keychain: it keeps the pairing in this browser only.
const webStore = {
  get: () => (typeof localStorage === "undefined" ? null : localStorage.getItem(STORE_KEY)),
  set: (value: string | null) => {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(STORE_KEY, value);
    else localStorage.removeItem(STORE_KEY);
  },
};

export async function loadPairing(): Promise<Pairing | null> {
  try {
    const raw = Platform.OS === "web" ? webStore.get() : await SecureStore.getItemAsync(STORE_KEY);
    return raw ? (JSON.parse(raw) as Pairing) : null;
  } catch {
    return null;
  }
}

export async function savePairing(pairing: Pairing | null) {
  try {
    const raw = pairing ? JSON.stringify(pairing) : null;
    if (Platform.OS === "web") webStore.set(raw);
    else if (raw) await SecureStore.setItemAsync(STORE_KEY, raw);
    else await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // Storage unavailable: this run only.
  }
}
