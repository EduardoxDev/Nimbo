import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  CircleCheck,
  CircleDot,
  Contrast,
  Droplet,
  ExternalLink,
  House,
  Info,
  Minus,
  Monitor,
  Music,
  Plus,
  Settings,
  Timer,
} from "lucide-react";
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
  | "about";

type SoonPage = "statusRing" | "calendar" | "pomodoro" | "water" | "home" | "shelf" | "hud";

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
];

const SOON_PAGES = new Set<PageId>(["statusRing", "calendar", "pomodoro", "water", "home", "shelf", "hud"]);
const FLOATING_MARGIN = DEFAULT_SETTINGS.marginY;
const REPOSITORY_URL = "https://github.com/EduardoxDev/Nimbo";
const PAGE_STORAGE_KEY = "nimbo-settings-page";

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

  const closeWindow = () => {
    if (isTauri()) void getCurrentWindow().hide();
  };

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
          {page === "about" && <AboutPage />}
          {SOON_PAGES.has(page) && <SoonPageView page={page as SoonPage} />}
        </div>
      </main>
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

function SoonPageView({ page }: { page: SoonPage }) {
  const t = useTranslation();
  const entry = PAGES.find((item) => item.id === page);
  const Icon = entry?.icon ?? Info;

  return (
    <div className="prefs-soon">
      <span className="prefs-soon__tile" style={{ background: entry?.color }} aria-hidden="true">
        <Icon size={30} strokeWidth={2.2} />
      </span>
      <span className="prefs-soon__badge">{t.prefs.comingSoon}</span>
      <p>{t.prefs.soon[page]}</p>
    </div>
  );
}

function AboutPage() {
  const copy = useTranslation().prefs.about;
  return (
    <div className="prefs-about">
      <span className="prefs-about__logo" aria-hidden="true">
        <span />
      </span>
      <strong>Nimbo</strong>
      <span>{copy.tagline}</span>
      <span className="prefs-about__meta">{copy.version} 0.1.0</span>
      <span className="prefs-about__meta">{copy.basedOn}</span>
      <button
        className="prefs-about__link"
        type="button"
        onClick={() => void openUrl(REPOSITORY_URL).catch(() => window.open(REPOSITORY_URL))}
      >
        {copy.github}
        <ExternalLink size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prefs-section">
      <h2>{title}</h2>
      <div className="prefs-card">{children}</div>
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="prefs-row">
      <div className="prefs-row__text">
        <span className="prefs-row__title">{title}</span>
        {hint && <span className="prefs-row__hint">{hint}</span>}
      </div>
      {children && <div className="prefs-row__control">{children}</div>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`prefs-toggle${checked ? " prefs-toggle--on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="prefs-toggle__knob" />
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="prefs-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className={`prefs-segmented__option${option.value === value ? " prefs-segmented__option--active" : ""}`}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step,
  format,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="prefs-stepper">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus size={13} strokeWidth={3} />
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus size={13} strokeWidth={3} />
      </button>
    </div>
  );
}
