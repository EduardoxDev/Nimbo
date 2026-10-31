import { useEffect, useState, type ReactNode } from "react";
import { Battery, BatteryCharging, BatteryLow, type LucideIcon } from "lucide-react";
import { useTranslation } from "../i18n";
import { IslandTabs, type IslandTab } from "../IslandTabs";
import { WeatherChip } from "../weather/WeatherChip";
import { useBattery } from "../system/useBattery";
import "./IslandBar.css";

export function IslandBar<Page extends string>({
  pages,
  currentPage,
  onPageChange,
  extra,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  onPageChange: (page: Page) => void;
  extra?: ReactNode;
}) {
  const t = useTranslation();
  const now = useMinuteClock();
  const battery = useBattery();
  const time = new Intl.DateTimeFormat(t.localeTag, { hour: "2-digit", minute: "2-digit" }).format(now);
  const BatteryIcon = battery?.charging ? BatteryCharging : battery && battery.level <= 20 ? BatteryLow : Battery;

  return (
    <div className="island-bar">
      <IslandTabs tabs={pages} current={currentPage} label={t.island.editor} variant="bar" onChange={onPageChange} />
      <span className="island-bar__status">
        {extra}
        <WeatherChip />
        {battery && (
          <span className="island-bar__battery" title={`${battery.level}%`}>
            <BatteryIcon size={14} strokeWidth={2.2} aria-hidden="true" />
            {battery.level}%
          </span>
        )}
        <strong>{time}</strong>
      </span>
    </div>
  );
}

export function PageChrome<Page extends string>({
  pages,
  currentPage,
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
  return (
    <section className={`island-page ${className}`} aria-label={label}>
      <IslandBar pages={pages} currentPage={currentPage} onPageChange={onPageChange} />
      {children}
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
