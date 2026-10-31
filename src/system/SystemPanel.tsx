import { Bluetooth, Cpu, Gauge, Moon, Volume2, VolumeX, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome, ProgressRing } from "../island/PageChrome";
import type { SystemState } from "./useSystem";

function Meter({ label, value, detail, color }: { label: string; value: number | null; detail: string; color: string }) {
  return (
    <div className="system-meter">
      <ProgressRing progress={(value ?? 0) / 100} size={54} stroke={5} color={color}>
        <strong>{value === null ? "–" : `${Math.round(value)}%`}</strong>
      </ProgressRing>
      <span className="system-meter__label">{label}</span>
      <span className="system-meter__detail">{detail}</span>
    </div>
  );
}

function Toggle({
  icon,
  label,
  on,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      className={`system-toggle${on ? " system-toggle--on" : ""}`}
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function SystemPanel<Page extends string>({
  system,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  system: SystemState;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const copy = useTranslation().system;
  const { stats, toggles, apps } = system;

  return (
    <PageChrome
      icon={Gauge}
      iconColor="#30d158"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className="system-panel"
      label={copy.title}
    >
      <div className="system-panel__body">
        <div className="system-panel__meters">
          <Meter label={copy.cpu} value={stats?.cpu ?? null} detail={copy.processor} color="#64d2ff" />
          <Meter
            label={copy.memory}
            value={stats?.memory ?? null}
            detail={stats ? copy.memoryDetail(stats.memoryUsedGb, stats.memoryTotalGb) : ""}
            color="#bf5af2"
          />
          {stats?.hasBattery && (
            <Meter
              label={copy.battery}
              value={stats.battery}
              detail={stats.charging ? copy.charging : copy.onBattery}
              color={stats.battery !== null && stats.battery <= 20 && !stats.charging ? "#ff453a" : "#30d158"}
            />
          )}
        </div>
        <div className="system-panel__toggles">
          <Toggle
            icon={<Wifi size={15} strokeWidth={2.4} aria-hidden="true" />}
            label={copy.wifi}
            on={toggles?.wifi ?? false}
            disabled={toggles?.wifi === null || !toggles}
            onChange={(value) => system.setRadio("wifi", value)}
          />
          <Toggle
            icon={<Bluetooth size={15} strokeWidth={2.4} aria-hidden="true" />}
            label={copy.bluetooth}
            on={toggles?.bluetooth ?? false}
            disabled={toggles?.bluetooth === null || !toggles}
            onChange={(value) => system.setRadio("bluetooth", value)}
          />
          <Toggle
            icon={<Moon size={15} strokeWidth={2.4} aria-hidden="true" />}
            label={copy.darkMode}
            on={toggles?.darkMode ?? false}
            disabled={!toggles}
            onChange={system.setDarkMode}
          />
        </div>
        <div className="system-panel__apps">
          {apps.length === 0 ? (
            <span className="system-panel__empty">
              <Cpu size={13} strokeWidth={2.4} aria-hidden="true" />
              {copy.noApps}
            </span>
          ) : (
            apps.slice(0, 3).map((app) => (
              <label key={app.pid} className="system-app">
                <button
                  className="system-app__mute"
                  type="button"
                  aria-label={app.muted ? copy.unmute(app.name) : copy.mute(app.name)}
                  onClick={() => system.setAppVolume(app, app.volume, !app.muted)}
                >
                  {app.muted ? <VolumeX size={14} strokeWidth={2.4} /> : <Volume2 size={14} strokeWidth={2.4} />}
                </button>
                <span className="system-app__name">{app.name}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(app.volume * 100)}
                  aria-label={copy.volumeOf(app.name)}
                  onChange={(event) => system.setAppVolume(app, Number(event.currentTarget.value) / 100, false)}
                />
              </label>
            ))
          )}
        </div>
        {system.error && (
          <span className="system-panel__error" role="alert">
            {system.error}
          </span>
        )}
      </div>
    </PageChrome>
  );
}
