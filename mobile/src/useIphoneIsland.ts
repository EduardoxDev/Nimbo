import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { NimboLive } from "../modules/nimbo-live";
import { activityOf } from "./shared/protocol";
import type { Pairing } from "./pairing";
import type { Status } from "./useNimbo";

type Storage = { set(key: string, value?: string): void };

/** The App Group shared with the widgets (missing in the web preview). */
function sharedStorage(): { storage: Storage | null; reload: () => void } {
  if (Platform.OS !== "ios") return { storage: null, reload: () => {} };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExtensionStorage } = require("@bacons/apple-targets") as typeof import("@bacons/apple-targets");
    return { storage: new ExtensionStorage("group.com.eduardoxdev.nimbo"), reload: () => ExtensionStorage.reloadWidget() };
  } catch {
    return { storage: null, reload: () => {} };
  }
}

/**
 * Keeps the iPhone's own island (Live Activity) and widgets in step with the PC
 * while the app is open; the relay takes over with pushes when it is closed.
 */
export function useIphoneIsland(pairing: Pairing | null, status: Status | null, registerToken: (token: string) => void) {
  const [running, setRunning] = useState(() => NimboLive.isRunning());
  const shared = useRef(sharedStorage());
  const lastWidgetSave = useRef(0);
  const registerRef = useRef(registerToken);
  registerRef.current = registerToken;

  // The widgets read the pairing to ask the relay themselves.
  useEffect(() => {
    if (!pairing) return;
    shared.current.storage?.set("pairing", JSON.stringify({ relay: pairing.relay, room: pairing.room, key: pairing.key }));
    shared.current.reload();
  }, [pairing?.relay, pairing?.room, pairing?.key]);

  useEffect(() => {
    const subscription = NimboLive.onPushToken((token) => registerRef.current(token));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!status) return;
    if (running) void NimboLive.update(activityOf(status, Date.now()));
    // Widgets refresh at most once a minute from here.
    if (Date.now() - lastWidgetSave.current > 60_000) {
      lastWidgetSave.current = Date.now();
      const { mascot: _drawing, ...rest } = status;
      shared.current.storage?.set("status", JSON.stringify(rest));
      shared.current.reload();
    }
  }, [status, running]);

  const start = async () => {
    await NimboLive.start(activityOf(status, Date.now()));
    setRunning(NimboLive.isRunning());
  };

  const stop = async () => {
    await NimboLive.end();
    setRunning(false);
  };

  return { supported: NimboLive.isSupported(), running, start, stop };
}
