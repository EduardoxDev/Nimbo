import type { Pairing } from "./pairing";

/** The same PC as before (a new home-Wi-Fi address or code from it does not count as a switch). */
export function samePc(stored: Pairing, next: Pairing) {
  if (stored.relay || next.relay) return stored.relay === next.relay && stored.room === next.room;
  const origin = (lan: string | null) => (lan ? lan.split("?")[0] : null);
  return origin(stored.lan) === origin(next.lan);
}

/** What the switch question names: the relay's host, or the PC's home-Wi-Fi address. */
export function pairingHost(pairing: Pairing) {
  try {
    return new URL(pairing.relay ?? pairing.lan ?? "").host;
  } catch {
    return "?";
  }
}
