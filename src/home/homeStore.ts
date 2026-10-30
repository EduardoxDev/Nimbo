import { invoke, isTauri } from "@tauri-apps/api/core";
import { HOME_DEMO, createDemoHome } from "../demo/homeDemo";

export type HomeDomain = "climate" | "light" | "switch" | "fan";

/** Mirrors `HomeEntity` in src-tauri/src/home_assistant.rs. */
export type HomeEntity = {
  entityId: string;
  domain: HomeDomain;
  name: string;
  state: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  temperatureStep: number | null;
  hvacModes: string[];
  hvacAction: string | null;
  fanMode: string | null;
  fanModes: string[];
  unit: string | null;
};

export type HomeStatus = {
  configured: boolean;
  url: string | null;
};

export type HomeServiceCall = {
  domain: HomeDomain;
  service: string;
  entityId: string;
  data?: Record<string, number | string>;
};

const FAVORITES_STORAGE_KEY = "nimbo-home-favorites";
export const SETTINGS_PAGE_STORAGE_KEY = "nimbo-settings-page";
const DEFAULT_OTHER_DEVICES = 4;

/** Which devices the island shows. `null` means "not chosen yet": use the defaults. */
export function loadHomeFavorites(): string[] | null {
  try {
    const stored = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : null;
  } catch {
    return null;
  }
}

export function saveHomeFavorites(favorites: string[]) {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Without storage the defaults keep working for this session.
  }
}

export function isHomeFavoritesEvent(event: StorageEvent) {
  return event.key === FAVORITES_STORAGE_KEY;
}

/** Defaults: every air conditioner plus the first few other devices. */
export function visibleHomeEntities(entities: HomeEntity[], favorites: string[] | null) {
  if (favorites) {
    const chosen = new Set(favorites);
    return entities.filter((entity) => chosen.has(entity.entityId));
  }
  const climates = entities.filter((entity) => entity.domain === "climate");
  const others = entities
    .filter((entity) => entity.domain !== "climate")
    .slice(0, DEFAULT_OTHER_DEVICES);
  return [...climates, ...others];
}

/** Temperatures read like "22°" or "22,5°" in the interface language. */
export function formatTemperature(value: number | null, localeTag: string) {
  if (value === null || Number.isNaN(value)) return "--";
  return `${new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }).format(value)}°`;
}

export function temperatureStepOf(entity: HomeEntity) {
  if (entity.temperatureStep && entity.temperatureStep > 0) return entity.temperatureStep;
  return entity.unit?.includes("F") ? 1 : 0.5;
}

/** Applies a call locally so the island answers before Home Assistant does. */
export function applyServiceCall(entity: HomeEntity, call: HomeServiceCall): HomeEntity {
  if (entity.entityId !== call.entityId) return entity;
  switch (call.service) {
    case "toggle":
      return { ...entity, state: entity.state === "on" ? "off" : "on" };
    case "set_temperature":
      return { ...entity, targetTemperature: Number(call.data?.temperature) };
    case "set_hvac_mode":
      return { ...entity, state: String(call.data?.hvac_mode) };
    case "turn_off":
      return { ...entity, state: "off" };
    default:
      return entity;
  }
}

/** One place for the native calls, so the demo can stand in for Home Assistant. */
export const homeApi = (() => {
  const demo = HOME_DEMO ? createDemoHome() : null;
  return {
    status: (): Promise<HomeStatus> =>
      demo
        ? Promise.resolve({ configured: true, url: "http://homeassistant.local:8123" })
        : isTauri()
          ? invoke<HomeStatus>("home_assistant_status")
          : Promise.resolve({ configured: false, url: null }),
    entities: (): Promise<HomeEntity[]> =>
      demo ? Promise.resolve(demo.entities()) : invoke<HomeEntity[]>("home_assistant_entities"),
    call: (call: HomeServiceCall): Promise<void> =>
      demo
        ? Promise.resolve(demo.call(call))
        : invoke("home_assistant_call", {
            domain: call.domain,
            service: call.service,
            entityId: call.entityId,
            data: call.data ?? null,
          }),
    connect: (url: string, token: string): Promise<HomeStatus> =>
      demo
        ? Promise.resolve({ configured: true, url })
        : invoke<HomeStatus>("connect_home_assistant", { url, token }),
    disconnect: (): Promise<void> =>
      demo ? Promise.resolve() : invoke("disconnect_home_assistant"),
  };
})();
