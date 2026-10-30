import { useCallback, useEffect, useRef, useState } from "react";
import {
  AirVent,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Fan,
  Flame,
  House,
  Lightbulb,
  Minus,
  Plug,
  Plus,
  Power,
  RefreshCcw,
  Snowflake,
  Sparkles,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "./i18n";
import {
  SETTINGS_PAGE_STORAGE_KEY,
  applyServiceCall,
  formatTemperature,
  homeApi,
  isHomeFavoritesEvent,
  loadHomeFavorites,
  temperatureStepOf,
  visibleHomeEntities,
  type HomeEntity,
  type HomeServiceCall,
} from "./home/homeStore";
import { IslandTabs } from "./IslandTabs";
import { AirConditioner3D, airModeOf } from "./home/AirConditioner3D";
import "./HomePanel.css";

export type HomePageLink<Page extends string> = {
  id: Page;
  label: string;
  icon: LucideIcon;
};

type LoadState = "loading" | "unconfigured" | "ready" | "error";

const REFRESH_INTERVAL_MS = 10_000;
const TEMPERATURE_SEND_DELAY_MS = 600;
const MAX_MODES = 5;

const MODE_ICONS: Record<string, LucideIcon> = {
  cool: Snowflake,
  heat: Flame,
  heat_cool: Thermometer,
  auto: Sparkles,
  dry: Droplets,
  fan_only: Fan,
  off: Power,
};

const DEVICE_ICONS: Record<string, LucideIcon> = {
  light: Lightbulb,
  switch: Plug,
  fan: Fan,
};

/** "off" always goes last so the power button sits at the end of the row. */
function orderedModes(modes: string[]) {
  const known = modes.filter((mode) => mode in MODE_ICONS);
  const withoutOff = known.filter((mode) => mode !== "off").slice(0, MAX_MODES - 1);
  return known.includes("off") ? [...withoutOff, "off"] : withoutOff;
}

export function HomePanel<Page extends string>({
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  pages: HomePageLink<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [entities, setEntities] = useState<HomeEntity[]>([]);
  const [favorites, setFavorites] = useState<string[] | null>(loadHomeFavorites);
  const [climateIndex, setClimateIndex] = useState(0);
  const [actionError, setActionError] = useState(false);
  const temperatureTimer = useRef<number | undefined>(undefined);
  const now = useMinuteClock();

  const refresh = useCallback(async () => {
    try {
      const status = await homeApi.status();
      if (!status.configured) {
        setLoadState("unconfigured");
        return;
      }
      setEntities(await homeApi.entities());
      setLoadState("ready");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(String(error));
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const syncFavorites = (event: StorageEvent) => {
      if (isHomeFavoritesEvent(event)) setFavorites(loadHomeFavorites());
    };
    window.addEventListener("storage", syncFavorites);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", syncFavorites);
      window.clearTimeout(temperatureTimer.current);
    };
  }, [refresh]);

  const send = useCallback(
    async (call: HomeServiceCall) => {
      setEntities((current) => current.map((entity) => applyServiceCall(entity, call)));
      setActionError(false);
      try {
        await homeApi.call(call);
        window.setTimeout(() => void refresh(), 800);
      } catch (error) {
        console.error("Home Assistant action failed", error);
        setActionError(true);
        void refresh();
      }
    },
    [refresh],
  );

  const visible = visibleHomeEntities(entities, favorites);
  const climates = visible.filter((entity) => entity.domain === "climate");
  const devices = visible.filter((entity) => entity.domain !== "climate");
  const climate = climates.length > 0 ? climates[climateIndex % climates.length] : null;

  const changeTemperature = (direction: 1 | -1) => {
    if (!climate || climate.targetTemperature === null) return;
    const step = temperatureStepOf(climate);
    const next = Math.min(
      climate.maxTemperature ?? 35,
      Math.max(climate.minTemperature ?? 10, climate.targetTemperature + step * direction),
    );
    const rounded = Math.round(next / step) * step;
    const call: HomeServiceCall = {
      domain: "climate",
      service: "set_temperature",
      entityId: climate.entityId,
      data: { temperature: rounded },
    };
    // Show every click at once; send only the final value after the clicks stop.
    setEntities((current) => current.map((entity) => applyServiceCall(entity, call)));
    window.clearTimeout(temperatureTimer.current);
    temperatureTimer.current = window.setTimeout(() => void send(call), TEMPERATURE_SEND_DELAY_MS);
  };

  const openSettings = () => {
    try {
      window.localStorage.setItem(SETTINGS_PAGE_STORAGE_KEY, "home");
    } catch {
      // The settings window simply opens on its last page.
    }
    if (isTauri()) {
      void invoke("open_settings_window").catch((error) =>
        console.error("Failed to open settings", error),
      );
    }
  };

  const pageIndex = Math.max(0, pages.findIndex((link) => link.id === currentPage));
  const previousPage = pages[(pageIndex - 1 + pages.length) % pages.length];
  const nextPage = pages[(pageIndex + 1) % pages.length];
  const dateLabel = new Intl.DateTimeFormat(t.localeTag, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .formatToParts(now)
    .filter((part) => part.type !== "literal")
    .map((part) => part.value.replace(/\.$/, ""))
    .join(" ");
  const timeLabel = new Intl.DateTimeFormat(t.localeTag, { hour: "2-digit", minute: "2-digit" }).format(now);
  const isClimateOn = climate !== null && climate.state !== "off";
  const ClimateIcon = climate ? (MODE_ICONS[climate.state] ?? AirVent) : AirVent;

  return (
    <section
      className={`home-panel${climate ? "" : " home-panel--no-climate"}`}
      aria-label={t.home.title}
    >
      <div className="np-clock">
        <House className="home-panel__clock-icon" size={15} strokeWidth={2.4} aria-hidden="true" />
        <span>{dateLabel}</span>
        <strong>{timeLabel}</strong>
      </div>

      <button
        className="np-nav np-nav--previous"
        type="button"
        title={previousPage.label}
        aria-label={`${t.music.previousPage}: ${previousPage.label}`}
        onClick={() => onPageChange(previousPage.id)}
      >
        <ChevronLeft size={15} strokeWidth={2.8} />
      </button>
      <button
        className="np-nav np-nav--next"
        type="button"
        title={nextPage.label}
        aria-label={`${t.music.nextPage}: ${nextPage.label}`}
        onClick={() => onPageChange(nextPage.id)}
      >
        <ChevronRight size={15} strokeWidth={2.8} />
      </button>

      {loadState === "ready" && visible.length > 0 ? (
        <>
          {climate && (
            <div className={`home-ac home-ac--${climate.state}`}>
              <button
                className="home-ac__unit"
                type="button"
                title={climates.length > 1 ? t.home.switchClimate : climate.name}
                aria-label={climates.length > 1 ? t.home.switchClimate : climate.name}
                disabled={climates.length < 2}
                onClick={() => setClimateIndex((index) => index + 1)}
              >
                <AirConditioner3D
                  mode={airModeOf(climate.state)}
                  display={formatTemperature(climate.targetTemperature, t.localeTag)}
                  label={climate.name}
                />
              </button>
              <div className="home-ac__info">
                <strong>
                  <ClimateIcon className="home-ac__mode-icon" size={15} strokeWidth={2.4} aria-hidden="true" />
                  {climate.name}
                </strong>
                <span>
                  {t.home.room} {formatTemperature(climate.currentTemperature, t.localeTag)}
                  {climate.hvacAction && ` · ${t.home.actions[climate.hvacAction as keyof typeof t.home.actions] ?? climate.hvacAction}`}
                </span>
              </div>
              <div className="home-ac__target" aria-label={t.home.targetLabel}>
                <button
                  type="button"
                  aria-label={t.home.decrease}
                  disabled={!isClimateOn || climate.targetTemperature === null}
                  onClick={() => changeTemperature(-1)}
                >
                  <Minus size={16} strokeWidth={2.8} />
                </button>
                <output aria-live="polite">{formatTemperature(climate.targetTemperature, t.localeTag)}</output>
                <button
                  type="button"
                  aria-label={t.home.increase}
                  disabled={!isClimateOn || climate.targetTemperature === null}
                  onClick={() => changeTemperature(1)}
                >
                  <Plus size={16} strokeWidth={2.8} />
                </button>
              </div>
              <div className="home-ac__modes" role="radiogroup" aria-label={climate.name}>
                {orderedModes(climate.hvacModes).map((mode) => {
                  const ModeIcon = MODE_ICONS[mode];
                  const label = t.home.modes[mode as keyof typeof t.home.modes] ?? mode;
                  return (
                    <button
                      key={mode}
                      className={`home-chip home-chip--mode-${mode}${climate.state === mode ? " home-chip--active" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={climate.state === mode}
                      title={label}
                      onClick={() =>
                        void send({
                          domain: "climate",
                          service: "set_hvac_mode",
                          entityId: climate.entityId,
                          data: { hvac_mode: mode },
                        })
                      }
                    >
                      <ModeIcon size={14} strokeWidth={2.3} aria-hidden="true" />
                      {climate.state === mode && mode !== "off" && <span>{label}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {devices.length > 0 && (
            <div className="home-devices">
              {devices.map((entity) => {
                const DeviceIcon = DEVICE_ICONS[entity.domain] ?? Plug;
                const isOn = entity.state === "on";
                return (
                  <button
                    key={entity.entityId}
                    className={`home-device home-device--${entity.domain}${isOn ? " home-device--on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={isOn}
                    title={`${entity.name}: ${isOn ? t.home.on : t.home.off}`}
                    onClick={() =>
                      void send({ domain: entity.domain, service: "toggle", entityId: entity.entityId })
                    }
                  >
                    <DeviceIcon size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>{entity.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          {actionError && (
            <span className="home-panel__toast" role="status">{t.home.actionFailed}</span>
          )}
        </>
      ) : (
        <div className="home-empty" role="status">
          {loadState === "loading" ? (
            <span className="home-empty__hint">{t.home.loading}</span>
          ) : loadState === "error" ? (
            <>
              <strong>{t.home.error}</strong>
              <span className="home-empty__hint" title={errorMessage ?? undefined}>
                {errorMessage}
              </span>
              <button className="home-empty__button" type="button" onClick={() => void refresh()}>
                <RefreshCcw size={13} strokeWidth={2.4} aria-hidden="true" />
                {t.common.retry}
              </button>
            </>
          ) : (
            <>
              <strong>{loadState === "ready" ? t.home.noDevices : t.home.connectTitle}</strong>
              <span className="home-empty__hint">
                {loadState === "ready" ? t.home.noDevicesHint : t.home.connectHint}
              </span>
              <button className="home-empty__button" type="button" onClick={openSettings}>
                {t.home.openSettings}
              </button>
            </>
          )}
        </div>
      )}

      <div className="home-panel__dots">
        <IslandTabs
          tabs={pages}
          current={currentPage}
          label={t.island.editor}
          variant="compact"
          revealIcons={showPageIcons}
          onChange={onPageChange}
        />
      </div>
    </section>
  );
}

function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}
