import { useId } from "react";
import { Droplet, Minus, Plus } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import type { WaterTracker } from "./useWater";

/** A glass that fills with a moving wave as the day's goal gets closer. */
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
  const number = new Intl.NumberFormat(t.localeTag);
  const goalCups = Math.ceil(goalMl / cupMl);
  const nextTime =
    water.nextReminderAt !== null
      ? new Intl.DateTimeFormat(t.localeTag, { hour: "2-digit", minute: "2-digit" }).format(water.nextReminderAt)
      : null;

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
      <div className="water-panel__body">
        <div className="water-panel__glass">
          <WaterGlass progress={water.progress} />
          <span className="water-panel__percent">{Math.round(water.progress * 100)}%</span>
        </div>
        <div className="water-panel__side">
          <strong className="water-panel__amount">
            {number.format(water.drankMl)}
            <span> / {number.format(goalMl)} ml</span>
          </strong>
          <span className="water-panel__cups">
            {water.progress >= 1 ? t.water.goalReached : t.water.cupsOf(water.day.cups, goalCups)}
          </span>
          <div className="water-panel__controls">
            <button className="water-panel__primary" type="button" onClick={water.add}>
              <Plus size={16} strokeWidth={2.8} aria-hidden="true" />
              {t.water.addCup(number.format(cupMl))}
            </button>
            <button
              className="focus-panel__icon"
              type="button"
              title={t.water.undo}
              aria-label={t.water.undo}
              disabled={water.day.cups === 0}
              onClick={water.undo}
            >
              <Minus size={16} strokeWidth={2.6} />
            </button>
          </div>
          <span className="water-panel__next">
            {reminderMinutes <= 0
              ? t.water.remindersOff
              : nextTime
                ? t.water.nextReminder(nextTime)
                : t.water.noMoreReminders}
          </span>
        </div>
      </div>
    </PageChrome>
  );
}
