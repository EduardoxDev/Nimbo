import { useId } from "react";
import { CalendarDays, Droplet, Plus, Undo2 } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import type { WaterTracker } from "./useWater";
import "./WaterMeter.css";

function WaterGlass({ progress }: { progress: number }) {
  const id = useId().replace(/:/g, "");
  const level = 96 - 84 * Math.min(1, progress);
  return (
    <svg className="water-glass" viewBox="0 0 80 104" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-inside`}>
          <path d="M14 10 H66 L60 96 Q59.5 100 55 100 H25 Q20.5 100 20 96 Z" />
        </clipPath>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fd3ff" />
          <stop offset="1" stopColor="#1a7cff" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-inside)`}>
        <g className="water-glass__level" style={{ transform: `translateY(${level}px)` }}>
          <path className="water-glass__wave water-glass__wave--back" d="M-80 4 Q-60 -2 -40 4 T0 4 T40 4 T80 4 T120 4 T160 4 V120 H-80 Z" fill="#5ab8ff" opacity="0.45" />
          <path className="water-glass__wave" d="M-80 6 Q-60 0 -40 6 T0 6 T40 6 T80 6 T120 6 T160 6 V120 H-80 Z" fill={`url(#${id}-water)`} />
        </g>
      </g>
      <path d="M14 10 H66 L60 96 Q59.5 100 55 100 H25 Q20.5 100 20 96 Z" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M20 18 L24 88" stroke="rgba(255,255,255,0.35)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function levelOf(progress: number) {
  return progress >= 1 ? 2 : progress >= 0.5 ? 1 : 0;
}

export function WaterPanel<Page extends string>({
  water,
  goalMl,
  cupMl,
  reminderMinutes,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  water: WaterTracker;
  goalMl: number;
  cupMl: number;
  reminderMinutes: number;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const copy = t.waterMeter;
  const number = new Intl.NumberFormat(t.localeTag);
  const liters = new Intl.NumberFormat(t.localeTag, { maximumFractionDigits: 1 });
  const weekday = new Intl.DateTimeFormat(t.localeTag, { weekday: "narrow" });
  const percent = Math.round(water.progress * 100);
  const level = levelOf(water.progress);
  const metDays = water.history.filter((day) => day.met).length;
  const average = water.history.reduce((sum, day) => sum + day.ml, 0) / Math.max(1, water.history.length) / 1000;
  const nextTime =
    water.nextReminderAt !== null
      ? new Intl.DateTimeFormat(t.localeTag, { hour: "2-digit", minute: "2-digit" }).format(water.nextReminderAt)
      : null;
  const reminder =
    reminderMinutes <= 0 ? t.water.remindersOff : nextTime ? t.water.nextReminder(nextTime) : t.water.noMoreReminders;

  return (
    <PageChrome
      icon={Droplet}
      iconColor="#5ac8fa"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className={`water-panel${water.progress >= 1 ? " water-panel--done" : ""}`}
      label={t.water.title}
    >
      <div className="water-meter">
        <section className="water-meter__card water-meter__today g-card" aria-label={copy.today}>
          <header className="water-meter__head">
            <span className="water-meter__label">
              <Droplet size={11} strokeWidth={2.4} aria-hidden="true" />
              {copy.today}
            </span>
            <span className="water-meter__amount">
              <strong>{number.format(water.drankMl)} ml</strong> / {number.format(goalMl)} ml
            </span>
          </header>
          <div className="water-meter__main">
            <strong className="water-meter__percent">{percent}%</strong>
            <WaterGlass progress={water.progress} />
            <div className="water-meter__ruler" role="img" aria-label={copy.levels[level]}>
              {copy.levels.map((name, index) => (
                <span key={name} className={`water-meter__stop${index === level ? " water-meter__stop--current" : ""}${index < level ? " water-meter__stop--passed" : ""}`}>
                  <i aria-hidden="true" />
                  {name}
                </span>
              ))}
            </div>
          </div>
          <span className="water-meter__foot">{reminder}</span>
        </section>
        <section className="water-meter__card water-meter__week g-card" aria-label={copy.week}>
          <header className="water-meter__head">
            <span className="water-meter__label">
              <CalendarDays size={11} strokeWidth={2.4} aria-hidden="true" />
              {copy.week}
            </span>
            <span className="water-meter__amount">
              <strong>{metDays}</strong>/7
            </span>
          </header>
          <ol className="water-meter__days">
            {water.history.map((day) => {
              const [year, month, date] = day.date.split("-").map(Number);
              return (
                <li
                  key={day.date}
                  className={`water-meter__day${day.met ? " water-meter__day--met" : ""}${day.isToday ? " water-meter__day--today" : ""}`}
                  title={`${number.format(day.ml)} ml`}
                >
                  <span>{weekday.format(new Date(year, month - 1, date))}</span>
                </li>
              );
            })}
          </ol>
          <span className="water-meter__summary">{copy.summary(liters.format(average), metDays)}</span>
          <div className="water-meter__actions">
            <button className="water-meter__button water-meter__button--primary" type="button" onClick={water.add}>
              <Plus size={13} strokeWidth={2.8} aria-hidden="true" />
              {number.format(cupMl)} ml
            </button>
            <button className="water-meter__button" type="button" title={t.water.undo} disabled={water.day.cups === 0} onClick={water.undo}>
              <Undo2 size={13} strokeWidth={2.4} aria-hidden="true" />
              {copy.undo}
            </button>
          </div>
        </section>
      </div>
    </PageChrome>
  );
}
