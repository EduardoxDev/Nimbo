import { isTauri } from "@tauri-apps/api/core";
import type { HomeEntity, HomeServiceCall } from "../home/homeStore";

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
