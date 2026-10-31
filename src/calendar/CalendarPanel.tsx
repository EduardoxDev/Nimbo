import { CalendarDays, MapPin } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { groupByDay, type CalendarEvent } from "./calendar";
import type { CalendarState } from "./useCalendar";

export function CalendarPanel<Page extends string>({
  calendar,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  calendar: CalendarState;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const copy = t.calendar;
  const time = new Intl.DateTimeFormat(t.localeTag, { hour: "2-digit", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat(t.localeTag, { weekday: "long", day: "numeric", month: "short" });
  const groups = groupByDay(calendar.events, calendar.now);

  const dayLabel = (day: number, offset: number) =>
    offset === 0 ? copy.today : offset === 1 ? copy.tomorrow : weekday.format(day);

  const timeLabel = (event: CalendarEvent) => {
    if (event.allDay) return copy.allDay;
    if (event.start <= calendar.now && event.end > calendar.now) return copy.now;
    return time.format(event.start);
  };

  return (
    <PageChrome
      icon={CalendarDays}
      iconColor="#ff453a"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className="calendar-panel"
      label={copy.title}
    >
      <div className="calendar-panel__body">
        {!calendar.hasSources ? (
          <div className="calendar-panel__empty">
            <strong>{copy.emptyTitle}</strong>
            <span>{copy.emptyHint}</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="calendar-panel__empty">
            <strong>{calendar.loaded ? copy.free : copy.loading}</strong>
            {calendar.loaded && <span>{copy.freeHint}</span>}
          </div>
        ) : (
          <ol className="calendar-days">
            {groups.map((group) => (
              <li key={group.day} className="calendar-day">
                <span className="calendar-day__label">{dayLabel(group.day, group.offset)}</span>
                <ul>
                  {group.events.map((event) => {
                    const isNow = !event.allDay && event.start <= calendar.now && event.end > calendar.now;
                    return (
                      <li key={event.id} className={`calendar-event${isNow ? " calendar-event--now" : ""}`}>
                        <span className="calendar-event__time">{timeLabel(event)}</span>
                        <span className="calendar-event__main">
                          <span className="calendar-event__title">{event.title}</span>
                          <span className="calendar-event__meta">
                            {event.location && <MapPin size={11} strokeWidth={2.4} aria-hidden="true" />}
                            {event.location ?? event.calendar}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {calendar.failed.length > 0 && (
          <span className="calendar-panel__error" role="status">
            {copy.failed(calendar.failed.join(", "))}
          </span>
        )}
      </div>
    </PageChrome>
  );
}
