import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { ActivityState } from "../../src/shared/protocol";

type NimboLiveNative = {
  isSupported(): boolean;
  isRunning(): boolean;
  start(state: ActivityState): Promise<void>;
  update(state: ActivityState): Promise<void>;
  end(): Promise<void>;
  addListener(event: "onPushToken", listener: (event: { token: string }) => void): EventSubscription;
};

// Missing in the web preview and in Expo Go: every call becomes a no-op there.
const native = requireOptionalNativeModule<NimboLiveNative>("NimboLive");

export const NimboLive = {
  isSupported: () => native?.isSupported() ?? false,
  isRunning: () => native?.isRunning() ?? false,
  start: (state: ActivityState) => native?.start(state) ?? Promise.resolve(),
  update: (state: ActivityState) => native?.update(state) ?? Promise.resolve(),
  end: () => native?.end() ?? Promise.resolve(),
  onPushToken: (listener: (token: string) => void) => native?.addListener("onPushToken", (event) => listener(event.token)) ?? { remove() {} },
};
