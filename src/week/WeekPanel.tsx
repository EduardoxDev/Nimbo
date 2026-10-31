import { BarChart3, Bot, Droplet, ListChecks, Timer, type LucideIcon } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { Mascot } from "../mascot/Mascot";
import type { MascotAccessory } from "../mascot/accessories";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import { statsDays, type Evolution, type StatKind, type StatsHistory } from "../stats/stats";
import type { HistoryDay } from "../water/water";
import "../water/WaterMeter.css";
import "./Week.css";

const KINDS: { key: StatKind; icon: LucideIcon; color: string }[] = [
  { key: "focus", icon: Timer, color: "#ff9f0a" },
  { key: "todos", icon: ListChecks, color: "#35e985" },
  { key: "agents", icon: Bot, color: "#bf8cff" },
];

export function WeekPanel<Page extends string>({
  stats,
  waterDays,
  evolution,
  accessory,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  stats: StatsHistory;
  waterDays: HistoryDay[];
  evolution: Evolution;
  accessory: MascotAccessory | null;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const copy = t.week;
  const weekday = new Intl.DateTimeFormat(t.localeTag, { weekday: "narrow" });
  const days = statsDays(stats, Date.now());
  const totals = KINDS.map((kind) => ({ ...kind, total: days.reduce((sum, day) => sum + day.stats[kind.key], 0) }));
  const waterMet = waterDays.filter((day) => day.met).length;
  const busiest = Math.max(1, ...days.map((day) => KINDS.reduce((sum, kind) => sum + day.stats[kind.key], 0)));

  return (
    <PageChrome
      icon={BarChart3}
      iconColor="#64d2ff"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className="week-panel"
      label={copy.title}
    >
      <div className="water-meter">
        <section className="water-meter__card week__summary g-card" aria-label={copy.title}>
          <header className="water-meter__head">
            <span className="water-meter__label">
              <BarChart3 size={11} strokeWidth={2.4} aria-hidden="true" />
              {copy.title}
            </span>
            <span className="water-meter__amount">
              <strong>{t.hub.level(evolution.level)}</strong> · {t.hub.points(evolution.points)}
            </span>
          </header>
          <div className="week__body">
            <Mascot mood="greeting" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={46} glow accessory={accessory} label="Nimbo" />
            <ul className="week__totals">
              <li>
                <Droplet size={12} strokeWidth={2.4} style={{ color: "#5ac8fa" }} aria-hidden="true" />
                <strong>{waterMet}/7</strong>
                <span>{copy.water}</span>
              </li>
              {totals.map((kind) => {
                const Icon = kind.icon;
                return (
                  <li key={kind.key}>
                    <Icon size={12} strokeWidth={2.4} style={{ color: kind.color }} aria-hidden="true" />
                    <strong>{kind.total}</strong>
                    <span>{copy[kind.key]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
        <section className="water-meter__card g-card" aria-label={copy.days}>
          <header className="water-meter__head">
            <span className="water-meter__label">{copy.days}</span>
          </header>
          <ol className="week__chart">
            {days.map((day, index) => {
              const [year, month, date] = day.date.split("-").map(Number);
              const water = waterDays[index];
              const label = `${day.date}: ${KINDS.map((kind) => `${copy[kind.key]} ${day.stats[kind.key]}`).join(", ")}`;
              return (
                <li key={day.date} className={day.isToday ? "week__day week__day--today" : "week__day"} title={label}>
                  <span className="week__stack">
                    {KINDS.map((kind) =>
                      day.stats[kind.key] > 0 ? (
                        <i key={kind.key} style={{ height: `${(day.stats[kind.key] / busiest) * 100}%`, background: kind.color }} />
                      ) : null,
                    )}
                  </span>
                  <span className={water?.met ? "week__drop week__drop--met" : "week__drop"} aria-hidden="true" />
                  <span className="week__weekday">{weekday.format(new Date(year, month - 1, date))}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </PageChrome>
  );
}
