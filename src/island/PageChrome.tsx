import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { useTranslation } from "../i18n";
import { IslandTabs, type IslandTab } from "../IslandTabs";

/**
 * Frame shared by the full-island pages: date and time on top, quiet chevrons
 * on the sides and the compact page tabs at the bottom.
 */
export function PageChrome<Page extends string>({
  icon: Icon,
  iconColor,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
  className,
  label,
  children,
}: {
  icon: LucideIcon;
  iconColor: string;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
  className: string;
  label: string;
  children: ReactNode;
}) {
  const t = useTranslation();
  const now = useMinuteClock();
  const index = Math.max(0, pages.findIndex((page) => page.id === currentPage));
  const previous = pages[(index - 1 + pages.length) % pages.length];
  const next = pages[(index + 1) % pages.length];
  const date = new Intl.DateTimeFormat(t.localeTag, { weekday: "short", day: "numeric", month: "short" })
    .formatToParts(now)
    .filter((part) => part.type !== "literal")
    .map((part) => part.value.replace(/\.$/, ""))
    .join(" ");
  const time = new Intl.DateTimeFormat(t.localeTag, { hour: "2-digit", minute: "2-digit" }).format(now);

  return (
    <section className={`island-page ${className}`} aria-label={label}>
      <div className="np-clock island-page__clock">
        <Icon size={15} strokeWidth={2.4} style={{ color: iconColor }} aria-hidden="true" />
        <span>{date}</span>
        <strong>{time}</strong>
      </div>
      <button
        className="np-nav np-nav--previous"
        type="button"
        title={previous.label}
        aria-label={`${t.music.previousPage}: ${previous.label}`}
        onClick={() => onPageChange(previous.id)}
      >
        <ChevronLeft size={15} strokeWidth={2.8} />
      </button>
      <button
        className="np-nav np-nav--next"
        type="button"
        title={next.label}
        aria-label={`${t.music.nextPage}: ${next.label}`}
        onClick={() => onPageChange(next.id)}
      >
        <ChevronRight size={15} strokeWidth={2.8} />
      </button>
      {children}
      <div className="island-page__tabs">
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

/** Progress ring used by the focus timer and the status ring. */
export function ProgressRing({
  progress,
  size,
  stroke,
  color,
  children,
}: {
  progress: number;
  size: number;
  stroke: number;
  color: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          className="progress-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <span className="progress-ring__content">{children}</span>}
    </span>
  );
}
