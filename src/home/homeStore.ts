import { invoke, isTauri } from "@tauri-apps/api/core";
import { HOME_DEMO, createDemoHome, createDemoInfrared } from "../demo/homeDemo";

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

/** Mirrors `BroadlinkDevice` in src-tauri/src/broadlink.rs. */
export type BroadlinkDevice = {
  host: string;
  mac: string;
  devtype: number;
  name: string;
};

/** Mirrors the structs in src-tauri/src/ir_climate.rs. */
export type IrModel = {
  code: number;
  label: string;
  minTemperature: number;
  maxTemperature: number;
  precision: number;
  operationModes: string[];
  fanModes: string[];
};

export type IrState = {
  mode: string;
  lastMode: string;
  temperature: number;
  fan: string;
};

export type IrStatus = {
  device: BroadlinkDevice | null;
  model: IrModel | null;
  state: IrState | null;
};

export type IrBrand = {
  brand: string;
  models: { code: number; models: string }[];
};

/** The infrared AC appears on the island as one more climate entity. */
export const IR_ENTITY_ID = "climate.nimbo_infrared";

const IR_ACTIONS: Record<string, string> = {
  off: "off",
  cool: "cooling",
  heat: "heating",
  dry: "drying",
  fan_only: "fan",
};

export function infraredEntity(status: IrStatus): HomeEntity | null {
  const { device, model, state } = status;
  if (!device || !model || !state) return null;
  return {
    entityId: IR_ENTITY_ID,
    domain: "climate",
    name: model.label,
    state: state.mode,
    currentTemperature: null,
    targetTemperature: state.temperature,
    minTemperature: model.minTemperature,
    maxTemperature: model.maxTemperature,
    temperatureStep: model.precision,
    hvacModes: [...model.operationModes, "off"],
    hvacAction: IR_ACTIONS[state.mode] ?? "idle",
    fanMode: state.fan || null,
    fanModes: model.fanModes,
    unit: "°C",
  };
}

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
    // The infrared AC is set up on purpose, so it always shows.
    return entities.filter((entity) => entity.entityId === IR_ENTITY_ID || chosen.has(entity.entityId));
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
  const infraredDemo = HOME_DEMO ? createDemoInfrared() : null;
  const irStatus = (): Promise<IrStatus> =>
    infraredDemo
      ? Promise.resolve(infraredDemo.status())
      : isTauri()
        ? invoke<IrStatus>("ir_status")
        : Promise.resolve({ device: null, model: null, state: null });
  return {
    /** Everything the island's Home page shows: Home Assistant plus the infrared AC. */
    island: async (): Promise<{ configured: boolean; entities: HomeEntity[] }> => {
      const [assistant, infrared] = await Promise.all([
        homeApi.status(),
        irStatus().catch(() => ({ device: null, model: null, state: null }) as IrStatus),
      ]);
      const virtual = infraredEntity(infrared);
      const entities = assistant.configured ? await homeApi.entities() : [];
      return {
        configured: assistant.configured || virtual !== null,
        entities: virtual ? [virtual, ...entities] : entities,
      };
    },
    irStatus,
    irDiscover: (target?: string): Promise<BroadlinkDevice[]> =>
      infraredDemo
        ? Promise.resolve(infraredDemo.discover())
        : invoke<BroadlinkDevice[]>("ir_discover", { target: target ?? null }),
    irSelectDevice: (device: BroadlinkDevice): Promise<IrStatus> =>
      infraredDemo
        ? Promise.resolve(infraredDemo.selectDevice(device))
        : invoke<IrStatus>("ir_select_device", { device }),
    irForget: (): Promise<IrStatus> =>
      infraredDemo ? Promise.resolve(infraredDemo.forget()) : invoke<IrStatus>("ir_forget"),
    irCatalog: (): Promise<IrBrand[]> =>
      infraredDemo ? Promise.resolve(infraredDemo.catalog()) : invoke<IrBrand[]>("ir_catalog"),
    irSelectModel: (code: number, label: string): Promise<IrStatus> =>
      infraredDemo
        ? Promise.resolve(infraredDemo.selectModel(code, label))
        : invoke<IrStatus>("ir_select_model", { code, label }),
    irApply: (service: string, value: number | string | null): Promise<IrStatus> =>
      infraredDemo
        ? Promise.resolve(infraredDemo.apply(service, value))
        : invoke<IrStatus>("ir_apply", { service, value }),
    status: (): Promise<HomeStatus> =>
      demo
        ? Promise.resolve({ configured: true, url: "http://homeassistant.local:8123" })
        : isTauri()
          ? invoke<HomeStatus>("home_assistant_status")
          : Promise.resolve({ configured: false, url: null }),
    entities: (): Promise<HomeEntity[]> =>
      demo ? Promise.resolve(demo.entities()) : invoke<HomeEntity[]>("home_assistant_entities"),
    call: (call: HomeServiceCall): Promise<void> =>
      call.entityId === IR_ENTITY_ID
        ? homeApi
            .irApply(call.service, call.data ? Object.values(call.data)[0] ?? null : null)
            .then(() => undefined)
        : demo
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
