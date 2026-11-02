import { Platform } from "react-native";

/** Free notifications for the web app (iPhone: only once added to the Home Screen, iOS 16.4+). */
export function webPushAvailable() {
  return Platform.OS === "web" && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Added to the Home Screen? Safari only allows notifications there. */
export function isInstalledWebApp() {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function keyBytes(base64url: string) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Asks permission and returns the subscription the relay will push to. */
export async function subscribeWebPush(relay: string): Promise<PushSubscriptionJSON> {
  const { key } = (await fetch(`${relay.replace(/\/$/, "")}/v1/vapid`).then((response) => response.json())) as { key: string | null };
  if (!key) throw new Error("no_vapid");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("denied");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  return subscription.toJSON();
}
