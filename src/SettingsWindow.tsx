import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  Bell,
  Bot,
  CalendarDays,
  Check,
  CircleCheck,
  CircleDot,
  Contrast,
  Droplet,
  ExternalLink,
  House,
  Info,
  Monitor,
  Music,
  Settings,
  Timer,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  loadSettings,
  normalizeSettings,
  type IslandSettings,
} from "./App";
import { LOCALE_CODES, TRANSLATIONS, useLocale, useTranslation } from "./i18n";
import { HomeSettingsPage } from "./home/HomeSettingsPage";
import { AgentsSettings } from "./agents/AgentsSettings";
import { SETTINGS_PAGE_STORAGE_KEY } from "./home/homeStore";
import { useUpdater } from "./updates/useUpdater";
import { CalendarSettingsPage } from "./calendar/CalendarSettings";
import { WelcomeSheet } from "./welcome/WelcomeSheet";
import { welcomePending } from "./welcome/welcome";
import { Row, Section, Segmented, Stepper, Toggle } from "./settings/controls";
import "./SettingsWindow.css";

type PageId =
  | "general"
  | "statusRing"
  | "display"
  | "appearance"
  | "music"
  | "todo"
  | "calendar"
  | "pomodoro"
  | "water"
  | "home"
  | "shelf"
  | "hud"
  | "agents"
  | "about";


/** Sidebar order and icon tiles, in the colours of the reference. */
const PAGES: { id: PageId; icon: typeof Settings; color: string }[] = [
  { id: "general", icon: Settings, color: "#8e8e93" },
  { id: "statusRing", icon: CircleDot, color: "#30d158" },
  { id: "display", icon: Monitor, color: "#5e5ce6" },
  { id: "appearance", icon: Contrast, color: "#48484a" },
  { id: "music", icon: Music, color: "#ff375f" },
  { id: "todo", icon: CircleCheck, color: "#30d158" },
  { id: "calendar", icon: CalendarDays, color: "#ff453a" },
  { id: "pomodoro", icon: Timer, color: "#ff9f0a" },
  { id: "water", icon: Droplet, color: "#0a84ff" },
  { id: "home", icon: House, color: "#40c8e0" },
  { id: "shelf", icon: Archive, color: "#ffb340" },
  { id: "hud", icon: Bell, color: "#0a84ff" },
  { id: "agents", icon: Bot, color: "#bf5af2" },
];

const FLOATING_MARGIN = DEFAULT_SETTINGS.marginY;
const REPOSITORY_URL = "https://github.com/EduardoxDev/Nimbo";
const PAGE_STORAGE_KEY = SETTINGS_PAGE_STORAGE_KEY;

function loadPage(): PageId {
  try {
    const stored = window.localStorage.getItem(PAGE_STORAGE_KEY);
    if (stored && (PAGES.some((page) => page.id === stored) || stored === "about")) {
      return stored as PageId;
    }
  } catch {
    // Opening on the default page is fine when storage is unavailable.
  }
  return "appearance";
}

/** Settings live in localStorage; the island window listens for the same key. */
function useSharedSettings() {
  const [settings, setSettings] = useState<IslandSettings>(loadSettings);

  useEffect(() => {
    const serialized = JSON.stringify(settings);
    if (window.localStorage.getItem(STORAGE_KEY) !== serialized) {
      window.localStorage.setItem(STORAGE_KEY, serialized);
    }
  }, [settings]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const next = normalizeSettings(JSON.parse(event.newValue));
        setSettings((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      } catch {
        // Ignore a partial write; the next one brings a full value.
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const update = (patch: Partial<IslandSettings>) =>
    setSettings((current) => normalizeSettings({ ...current, ...patch }));

  return [settings, update] as const;
}

export default function SettingsWindow() {
  const t = useTranslation();
  const [settings, update] = useSharedSettings();
  const [page, setPage] = useState<PageId>(loadPage);

  useEffect(() => {
    document.title = t.prefs.windowTitle;
  }, [t]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAGE_STORAGE_KEY, page);
    } catch {
      // Remembering the last page is only a convenience.
    }
  }, [page]);

  // The island can ask for a page (e.g. "Home" from its empty state).
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key === PAGE_STORAGE_KEY) setPage(loadPage());
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  const closeWindow = () => {
    if (isTauri()) void getCurrentWindow().hide();
  };

  const [showWelcome, setShowWelcome] = useState(welcomePending);

  return (
    <div className="prefs">
      <aside className="prefs__sidebar" data-tauri-drag-region>
        <div className="prefs__traffic" data-tauri-drag-region>
          <button
            className="prefs__close"
            type="button"
            aria-label={t.prefs.close}
            title={t.prefs.close}
            onClick={closeWindow}
          />
        </div>
        <nav className="prefs__nav" aria-label={t.prefs.windowTitle}>
          {PAGES.map(({ id, icon: Icon, color }) => (
            <SidebarItem
              key={id}
              label={t.prefs.pages[id]}
              color={color}
              icon={<Icon size={15} strokeWidth={2.4} />}
              isActive={page === id}
              onSelect={() => setPage(id)}
            />
          ))}
        </nav>
        <div className="prefs__nav prefs__nav--bottom">
          <SidebarItem
            label={t.prefs.pages.about}
            color="#8e8e93"
            icon={<Info size={15} strokeWidth={2.4} />}
            isActive={page === "about"}
            onSelect={() => setPage("about")}
          />
        </div>
      </aside>

      <main className="prefs__content">
        <header className="prefs__header" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{t.prefs.pages[page]}</h1>
        </header>
        <div className="prefs__scroll" key={page}>
          {page === "appearance" && <AppearancePage settings={settings} update={update} />}
          {page === "general" && <GeneralPage settings={settings} update={update} />}
          {page === "display" && <DisplayPage settings={settings} update={update} />}
          {page === "music" && <MusicPage />}
          {page === "todo" && <TodoPage settings={settings} update={update} />}
          {page === "home" && <HomeSettingsPage />}
          {page === "agents" && <AgentsSettings />}
          {page === "statusRing" && <StatusRingPage settings={settings} update={update} />}
          {page === "pomodoro" && <PomodoroPage settings={settings} update={update} />}
          {page === "water" && <WaterPage settings={settings} update={update} />}
          {page === "hud" && <HudPage settings={settings} update={update} />}
          {page === "shelf" && <ShelfPage />}
          {page === "about" && <AboutPage />}
          {page === "calendar" && <CalendarSettingsPage settings={settings} update={update} />}
        </div>
      </main>
      {showWelcome && <WelcomeSheet onDone={() => setShowWelcome(false)} />}
    </div>
  );
}

function SidebarItem({
  label,
  color,
  icon,
  isActive,
  onSelect,
}: {
  label: string;
  color: string;
  icon: ReactNode;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`prefs-item${isActive ? " prefs-item--active" : ""}`}
      type="button"
      aria-current={isActive ? "page" : undefined}
      onClick={onSelect}
    >
      <span className="prefs-item__tile" style={{ background: color }} aria-hidden="true">
        {icon}
      </span>
      <span className="prefs-item__label">{label}</span>
    </button>
  );
}

type PageProps = {
  settings: IslandSettings;
  update: (patch: Partial<IslandSettings>) => void;
};

function AppearancePage({ settings, update }: PageProps) {
  const t = useTranslation();
  const copy = t.prefs.appearance;
  const isFloating = settings.marginY > 0;
  const isGlass = settings.appearanceMode === "liquidGlass";

  return (
    <>
      <Section title={copy.notchStyle}>
        <div className="notch-styles" role="radiogroup" aria-label={copy.notchStyle}>
          <NotchStyleCard
            title={copy.classic}
            hint={copy.classicHint}
            floating={false}
            isSelected={!isFloating}
            onSelect={() => update({ marginY: 0 })}
          />
          <NotchStyleCard
            title={copy.floating}
            hint={copy.floatingHint}
            floating
            isSelected={isFloating}
            onSelect={() => update({ marginY: isFloating ? settings.marginY : FLOATING_MARGIN })}
          />
        </div>
        <Row title={copy.glass} hint={copy.glassHint}>
          <Toggle
            label={copy.glass}
            checked={isGlass}
            onChange={(checked) => update({ appearanceMode: checked ? "liquidGlass" : "classic" })}
          />
        </Row>
        <Row title={copy.glassTint}>
          <Stepper
            value={settings.glassTint}
            min={0}
            max={100}
            step={5}
            format={(value) => `${value}%`}
            decreaseLabel={`${copy.decrease} ${copy.glassTint}`}
            increaseLabel={`${copy.increase} ${copy.glassTint}`}
            onChange={(glassTint) => update({ glassTint })}
          />
        </Row>
      </Section>

      <Section title={copy.notch}>
        <Row title={copy.openNotch}>
          <Segmented
            label={copy.openNotch}
            value={settings.openMode}
            options={[
              { value: "hover", label: copy.hover },
              { value: "click", label: copy.click },
            ]}
            onChange={(openMode) => update({ openMode })}
          />
        </Row>
        <Row title={copy.pageIcons} hint={copy.pageIconsHint}>
          <Toggle
            label={copy.pageIcons}
            checked={settings.showPageIcons}
            onChange={(showPageIcons) => update({ showPageIcons })}
          />
        </Row>
      </Section>

      <Section title={copy.motion}>
        <Row title={copy.animationSpeed}>
          <Segmented
            label={copy.animationSpeed}
            value={settings.animationSpeed}
            options={[
              { value: "normal", label: copy.normal },
              { value: "fast", label: copy.fast },
            ]}
            onChange={(animationSpeed) => update({ animationSpeed })}
          />
        </Row>
      </Section>
    </>
  );
}

function NotchStyleCard({
  title,
  hint,
  floating,
  isSelected,
  onSelect,
}: {
  title: string;
  hint: string;
  floating: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(),
  );

  return (
    <button
      className={`notch-card${isSelected ? " notch-card--selected" : ""}`}
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
    >
      <span className={`notch-card__screen${floating ? " notch-card__screen--floating" : ""}`} aria-hidden="true">
        <span className="notch-card__pill">
          <span className="notch-card__ring" />
          <span>{time}</span>
        </span>
      </span>
      <span className="notch-card__text">
        <strong>{title}</strong>
        <span>{hint}</span>
      </span>
      {isSelected && (
        <span className="notch-card__check" aria-hidden="true">
          <Check size={11} strokeWidth={3.4} />
        </span>
      )}
    </button>
  );
}

function GeneralPage({ settings, update }: PageProps) {
  const t = useTranslation();
  const copy = t.prefs.general;
  const { locale, setLocale } = useLocale();
  const [launchAtStartup, setLaunchAtStartup] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("get_launch_at_startup")
      .then(setLaunchAtStartup)
      .catch((error) => console.error("Failed to read launch at startup", error));
  }, []);

  const changeLaunchAtStartup = (enabled: boolean) => {
    setLaunchAtStartup(enabled);
    invoke("set_launch_at_startup", { enabled })
      .catch((error) => {
        console.error("Failed to change launch at startup", error);
        setLaunchAtStartup(!enabled);
      });
  };

  return (
    <Section title={copy.section}>
      <Row title={copy.language}>
        <Segmented
          label={copy.language}
          value={locale}
          options={LOCALE_CODES.map((code) => ({
            value: code,
            label: TRANSLATIONS[code].localeLabel.replace(/ \(.*\)$/, ""),
          }))}
          onChange={setLocale}
        />
      </Row>
      <Row title={copy.launchAtStartup} hint={copy.launchAtStartupHint}>
        <Toggle
          label={copy.launchAtStartup}
          checked={launchAtStartup ?? false}
          disabled={launchAtStartup === null}
          onChange={changeLaunchAtStartup}
        />
      </Row>
      <Row title={copy.collapsedText}>
        <Toggle
          label={copy.collapsedText}
          checked={settings.showCollapsedText}
          onChange={(showCollapsedText) => update({ showCollapsedText })}
        />
      </Row>
      <Row title={copy.idleTodoCount}>
        <Toggle
          label={copy.idleTodoCount}
          checked={settings.showIdleTodoCount}
          onChange={(showIdleTodoCount) => update({ showIdleTodoCount })}
        />
      </Row>
    </Section>
  );
}

function DisplayPage({ settings, update }: PageProps) {
  const t = useTranslation();
  const copy = t.prefs.display;
  const appearance = t.prefs.appearance;
  const percent = (value: number) => `${Math.round(value)}%`;

  return (
    <Section title={copy.section}>
      <Row title={copy.collapsedScale}>
        <Stepper
          value={Math.round(settings.collapsedScale * 100)}
          min={75}
          max={140}
          step={5}
          format={percent}
          decreaseLabel={`${appearance.decrease} ${copy.collapsedScale}`}
          increaseLabel={`${appearance.increase} ${copy.collapsedScale}`}
          onChange={(value) => update({ collapsedScale: value / 100 })}
        />
      </Row>
      <Row title={copy.expandedScale}>
        <Stepper
          value={Math.round(settings.expandedScale * 100)}
          min={75}
          max={140}
          step={5}
          format={percent}
          decreaseLabel={`${appearance.decrease} ${copy.expandedScale}`}
          increaseLabel={`${appearance.increase} ${copy.expandedScale}`}
          onChange={(value) => update({ expandedScale: value / 100 })}
        />
      </Row>
      <Row title={copy.opacity}>
        <Stepper
          value={settings.opacity}
          min={50}
          max={100}
          step={5}
          format={percent}
          decreaseLabel={`${appearance.decrease} ${copy.opacity}`}
          increaseLabel={`${appearance.increase} ${copy.opacity}`}
          onChange={(opacity) => update({ opacity })}
        />
      </Row>
      <Row title={copy.marginY}>
        <Stepper
          value={settings.marginY}
          min={0}
          max={160}
          step={2}
          format={(value) => `${value} px`}
          decreaseLabel={`${appearance.decrease} ${copy.marginY}`}
          increaseLabel={`${appearance.increase} ${copy.marginY}`}
          onChange={(marginY) => update({ marginY })}
        />
      </Row>
      <Row title={copy.hideInFullscreen} hint={copy.hideInFullscreenHint}>
        <Toggle
          label={copy.hideInFullscreen}
          checked={settings.hideInFullscreen}
          onChange={(hideInFullscreen) => update({ hideInFullscreen })}
        />
      </Row>
    </Section>
  );
}

function MusicPage() {
  const copy = useTranslation().prefs.music;
  return (
    <Section title={copy.section}>
      <Row title={copy.lyrics} hint={copy.lyricsHint} />
      <Row title={copy.player} hint={copy.playerHint} />
    </Section>
  );
}

function TodoPage({ settings, update }: PageProps) {
  const copy = useTranslation().prefs.todo;
  return (
    <Section title={copy.section}>
      <Row title={copy.carryOver}>
        <Toggle
          label={copy.carryOver}
          checked={settings.carryOverIncompleteTodos}
          onChange={(carryOverIncompleteTodos) => update({ carryOverIncompleteTodos })}
        />
      </Row>
      <Row title={copy.reorder}>
        <Toggle
          label={copy.reorder}
          checked={settings.enableTodoReorder}
          onChange={(enableTodoReorder) => update({ enableTodoReorder })}
        />
      </Row>
    </Section>
  );
}

function StatusRingPage({ settings, update }: PageProps) {
  const copy = useTranslation().prefs.statusRing;
  return (
    <Section title={copy.section}>
      <Row title={copy.source}>
        <Segmented
          label={copy.source}
          value={settings.statusRing}
          options={[
            { value: "auto", label: copy.auto },
            { value: "focus", label: copy.focus },
            { value: "water", label: copy.water },
            { value: "none", label: copy.none },
          ]}
          onChange={(statusRing) => update({ statusRing })}
        />
      </Row>
      <p className="prefs-card__hint prefs-card__hint--bottom">{copy.hint}</p>
    </Section>
  );
}

function PomodoroPage({ settings, update }: PageProps) {
  const t = useTranslation();
  const copy = t.prefs.pomodoro;
  const appearance = t.prefs.appearance;
  const minutes = (value: number) => `${value} min`;
  const stepper = (
    title: string,
    value: number,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
    onChange: (value: number) => void,
  ) => (
    <Row title={title}>
      <Stepper
        value={value}
        min={min}
        max={max}
        step={step}
        format={format}
        decreaseLabel={`${appearance.decrease} ${title}`}
        increaseLabel={`${appearance.increase} ${title}`}
        onChange={onChange}
      />
    </Row>
  );

  return (
    <Section title={copy.section}>
      {stepper(copy.focus, settings.focusMinutes, 5, 90, 5, minutes, (focusMinutes) => update({ focusMinutes }))}
      {stepper(copy.shortBreak, settings.shortBreakMinutes, 1, 30, 1, minutes, (shortBreakMinutes) => update({ shortBreakMinutes }))}
      {stepper(copy.longBreak, settings.longBreakMinutes, 5, 60, 5, minutes, (longBreakMinutes) => update({ longBreakMinutes }))}
      {stepper(copy.rounds, settings.focusRounds, 2, 8, 1, String, (focusRounds) => update({ focusRounds }))}
      <Row title={copy.autoStart} hint={copy.autoStartHint}>
        <Toggle label={copy.autoStart} checked={settings.focusAutoStart} onChange={(focusAutoStart) => update({ focusAutoStart })} />
      </Row>
      <Row title={copy.sound}>
        <Toggle label={copy.sound} checked={settings.focusSound} onChange={(focusSound) => update({ focusSound })} />
      </Row>
    </Section>
  );
}

function WaterPage({ settings, update }: PageProps) {
  const t = useTranslation();
  const copy = t.prefs.waterPrefs;
  const appearance = t.prefs.appearance;
  const number = new Intl.NumberFormat(t.localeTag);
  const ml = (value: number) => `${number.format(value)} ml`;

  return (
    <Section title={copy.section}>
      <Row title={copy.goal}>
        <Stepper
          value={settings.waterGoalMl}
          min={500}
          max={5000}
          step={250}
          format={ml}
          decreaseLabel={`${appearance.decrease} ${copy.goal}`}
          increaseLabel={`${appearance.increase} ${copy.goal}`}
          onChange={(waterGoalMl) => update({ waterGoalMl })}
        />
      </Row>
      <Row title={copy.cup}>
        <Stepper
          value={settings.waterCupMl}
          min={100}
          max={1000}
          step={50}
          format={ml}
          decreaseLabel={`${appearance.decrease} ${copy.cup}`}
          increaseLabel={`${appearance.increase} ${copy.cup}`}
          onChange={(waterCupMl) => update({ waterCupMl })}
        />
      </Row>
      <Row title={copy.reminder}>
        <Stepper
          value={settings.waterReminderMinutes}
          min={0}
          max={180}
          step={15}
          format={(value) => (value === 0 ? copy.off : `${value} min`)}
          decreaseLabel={`${appearance.decrease} ${copy.reminder}`}
          increaseLabel={`${appearance.increase} ${copy.reminder}`}
          onChange={(waterReminderMinutes) => update({ waterReminderMinutes })}
        />
      </Row>
    </Section>
  );
}

function HudPage({ settings, update }: PageProps) {
  const copy = useTranslation().prefs.hudPrefs;
  const toggle = (title: string, hint: string, key: "hudVolume" | "hudBrightness" | "hudTrack" | "wheelVolume") => (
    <Row title={title} hint={hint}>
      <Toggle label={title} checked={settings[key]} onChange={(value) => update({ [key]: value })} />
    </Row>
  );
  return (
    <Section title={copy.section}>
      {toggle(copy.volume, copy.volumeHint, "hudVolume")}
      {toggle(copy.brightness, copy.brightnessHint, "hudBrightness")}
      {toggle(copy.track, copy.trackHint, "hudTrack")}
      {toggle(copy.wheel, copy.wheelHint, "wheelVolume")}
      <p className="prefs-card__hint prefs-card__hint--bottom">{copy.note}</p>
    </Section>
  );
}

function ShelfPage() {
  const copy = useTranslation().prefs.shelfPrefs;
  const [cleared, setCleared] = useState(false);
  return (
    <Section title={copy.section}>
      <p className="prefs-card__hint prefs-card__hint--bottom">{copy.hint}</p>
      <Row title={cleared ? copy.cleared : copy.clear}>
        <button
          className="prefs-button prefs-button--quiet"
          type="button"
          disabled={cleared}
          onClick={() => {
            if (!isTauri()) return;
            void invoke("shelf_remove", { id: null }).then(() => setCleared(true));
          }}
        >
          {copy.clear}
        </button>
      </Row>
    </Section>
  );
}

function AboutPage() {
  const t = useTranslation();
  const copy = t.prefs.about;
  const updates = t.updates;
  const updater = useUpdater({ background: false });
  const [version, setVersion] = useState("");
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const copyDiagnostics = async () => {
    if (!isTauri()) return;
    try {
      await navigator.clipboard.writeText(await invoke<string>("diagnostics_report"));
      setDiagnosticsCopied(true);
    } catch (error) {
      console.error("Failed to copy diagnostics", error);
    }
  };

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setVersion).catch(() => {});
  }, []);

  const status = updater.state;
  const statusText =
    status.status === "checking"
      ? updates.checking
      : status.status === "latest"
        ? updates.latest
        : status.status === "error"
          ? updates.error
          : status.status === "available"
            ? updates.installHint
            : status.status === "downloading"
              ? updates.downloading(status.percent)
              : null;

  return (
    <div className="prefs-about">
      <span className="prefs-about__logo" aria-hidden="true">
        <span />
      </span>
      <strong>Nimbo</strong>
      <span>{copy.tagline}</span>
      <span className="prefs-about__meta">{copy.version} {version}</span>
      <span className="prefs-about__meta">{copy.basedOn}</span>
      <button
        className="prefs-about__link"
        type="button"
        onClick={() => void openUrl(REPOSITORY_URL).catch(() => window.open(REPOSITORY_URL))}
      >
        {copy.github}
        <ExternalLink size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button
        className="prefs-button"
        type="button"
        disabled={status.status === "checking" || status.status === "downloading"}
        onClick={() =>
          status.status === "available" ? void updater.install() : void updater.checkNow()
        }
      >
        {status.status === "available" ? updates.installVersion(status.version) : updates.check}
      </button>
      {statusText && (
        <span className="prefs-about__meta" role="status">
          {statusText}
        </span>
      )}
      <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void copyDiagnostics()}>
        {copy.copyDiagnostics}
      </button>
      {diagnosticsCopied && (
        <span className="prefs-about__meta" role="status">
          {copy.diagnosticsCopied}
        </span>
      )}
    </div>
  );
}
