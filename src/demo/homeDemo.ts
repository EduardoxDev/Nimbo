import { isTauri } from "@tauri-apps/api/core";
import type { BroadlinkDevice, HomeEntity, HomeServiceCall, IrBrand, IrStatus } from "../home/homeStore";

/**
 * Design preview for the Home page: open the Vite dev server with `?demo=home`
 * to see the island and the settings window with a pretend Home Assistant.
 * Never active in the desktop app or in production builds.
 */
export const HOME_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "home";

const climate = (patch: Partial<HomeEntity>): HomeEntity => ({
  entityId: "climate.ar_da_sala",
  domain: "climate",
  name: "Ar da sala",
  state: "cool",
  currentTemperature: 26.5,
  targetTemperature: 22,
  minTemperature: 16,
  maxTemperature: 30,
  temperatureStep: 1,
  hvacModes: ["cool", "heat", "auto", "fan_only", "off"],
  hvacAction: "cooling",
  fanMode: "auto",
  fanModes: ["auto", "low", "high"],
  unit: "°C",
  ...patch,
});

const device = (entityId: string, name: string, state: string): HomeEntity => ({
  ...climate({}),
  entityId,
  domain: entityId.split(".")[0] as HomeEntity["domain"],
  name,
  state,
  currentTemperature: null,
  targetTemperature: null,
  hvacModes: [],
  hvacAction: null,
  fanMode: null,
  fanModes: [],
});

export function createDemoHome() {
  let entities: HomeEntity[] = [
    climate({}),
    climate({
      entityId: "climate.ar_do_quarto",
      name: "Ar do quarto",
      state: "off",
      currentTemperature: 24,
      targetTemperature: 23,
      hvacAction: "off",
    }),
    device("light.sala", "Sala", "on"),
    device("light.quarto", "Quarto", "off"),
    device("switch.cafeteira", "Cafeteira", "off"),
    device("fan.ventilador", "Ventilador", "on"),
  ];

  return {
    entities: () => entities.map((entity) => ({ ...entity })),
    call: (call: HomeServiceCall) => {
      entities = entities.map((entity) => {
        if (entity.entityId !== call.entityId) return entity;
        if (call.service === "toggle") return { ...entity, state: entity.state === "on" ? "off" : "on" };
        if (call.service === "set_temperature") {
          return { ...entity, targetTemperature: Number(call.data?.temperature) };
        }
        if (call.service === "set_hvac_mode") {
          const mode = String(call.data?.hvac_mode);
          const action = { cool: "cooling", heat: "heating", fan_only: "fan", off: "off" }[mode] ?? "idle";
          return { ...entity, state: mode, hvacAction: action };
        }
        return entity;
      });
    },
  };
}

/** Pretend Broadlink RM4 Mini with an Elgin model, for the settings preview. */
export function createDemoInfrared() {
  const device: BroadlinkDevice = { host: "192.168.0.42", mac: "e8:16:56:aa:bb:cc", devtype: 0x6539, name: "RM4 Mini" };
  let status: IrStatus = { device: null, model: null, state: null };
  const brands: IrBrand[] = [
    { brand: "Elgin", models: [{ code: 2800, models: "HVQI18B2IA" }, { code: 2801, models: "HVQI12B2FB" }] },
    { brand: "Gree", models: [{ code: 1180, models: "YAC1FB, YBOF2" }] },
    { brand: "Springer", models: [{ code: 2780, models: "Midea Springer 42MACA" }] },
  ];
  return {
    status: () => status,
    discover: () => [device],
    selectDevice: (chosen: BroadlinkDevice) => (status = { ...status, device: chosen }),
    forget: () => (status = { device: null, model: null, state: null }),
    catalog: () => brands,
    selectModel: (code: number, label: string) =>
      (status = {
        ...status,
        model: { code, label, minTemperature: 17, maxTemperature: 30, precision: 1, operationModes: ["cool", "heat", "fan_only"], fanModes: ["low", "high", "auto"] },
        state: { mode: "off", lastMode: "cool", temperature: 23, fan: "auto" },
      }),
    apply: (service: string, value: number | string | null) => {
      if (!status.state) return status;
      const state = { ...status.state };
      if (service === "set_hvac_mode" && typeof value === "string") {
        state.mode = value;
        if (value !== "off") state.lastMode = value;
      }
      if (service === "set_temperature" && typeof value === "number") state.temperature = value;
      if (service === "turn_on") state.mode = state.lastMode;
      if (service === "turn_off") state.mode = "off";
      return (status = { ...status, state });
    },
  };
}
