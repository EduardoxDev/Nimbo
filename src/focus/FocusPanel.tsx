import { Pause, Play, RotateCcw, SkipForward, Timer } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome, ProgressRing } from "../island/PageChrome";
import { formatClock, type FocusTimer } from "./useFocusTimer";
import { Mascot } from "../mascot/Mascot";
import { identityOf, type MascotMood } from "../mascot/engine";

/** A friend from "focus together", as the focus page shows them. */
export type FocusFriend = { id: string; name: string; mood: MascotMood; label: string };

const PHASE_COLORS = {
  focus: "#ff7a59",
  short: "#35e985",
  long: "#5ac8fa",
};

export function FocusPanel<Page extends string>({
  timer,
  rounds,
  friends = [],
  onWave,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  timer: FocusTimer;
  rounds: number;
  friends?: FocusFriend[];
  onWave?: (id: string) => void;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const { state } = timer;
  const color = PHASE_COLORS[state.phase];
  const isRunning = state.status === "running";
  const doneInCycle = state.completed;

  return (
    <PageChrome
      icon={Timer}
      iconColor={color}
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className={`focus-panel focus-panel--${state.phase}${isRunning ? " focus-panel--running" : ""}`}
      label={t.focus.title}
    >
      <div className="focus-panel__body">
        <ProgressRing progress={timer.progress} size={112} stroke={7} color={color}>
          <strong className="focus-panel__time">{formatClock(timer.remainingMs)}</strong>
          <span className="focus-panel__phase">{t.focus.phases[state.phase]}</span>
        </ProgressRing>

        <div className="focus-panel__side">
          <strong className="focus-panel__title">
            {state.status === "paused" ? t.focus.paused : t.focus.headlines[state.phase]}
          </strong>
          <div className="focus-panel__rounds" aria-label={t.focus.roundOf(Math.min(doneInCycle + 1, rounds), rounds)}>
            {Array.from({ length: rounds }, (_, index) => (
              <span
                key={index}
                className={[
                  "focus-panel__round",
                  index < doneInCycle ? "focus-panel__round--done" : "",
                  index === doneInCycle && state.phase === "focus" ? "focus-panel__round--current" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ))}
            <span className="focus-panel__round-label">
              {t.focus.roundOf(Math.min(doneInCycle + (state.phase === "focus" ? 1 : 0), rounds), rounds)}
            </span>
          </div>
          <div className="focus-panel__controls">
            <button
              className="focus-panel__primary"
              type="button"
              onClick={isRunning ? timer.pause : timer.start}
            >
              {isRunning ? (
                <Pause size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              ) : (
                <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              )}
              {isRunning ? t.focus.pause : state.status === "paused" ? t.focus.resume : t.focus.start}
            </button>
            <button className="focus-panel__icon" type="button" title={t.focus.reset} aria-label={t.focus.reset} onClick={timer.reset}>
              <RotateCcw size={16} strokeWidth={2.3} />
            </button>
            <button className="focus-panel__icon" type="button" title={t.focus.skip} aria-label={t.focus.skip} onClick={timer.skip}>
              <SkipForward size={16} strokeWidth={2.3} />
            </button>
          </div>
          {friends.length > 0 && (
            <div className="focus-panel__friends" aria-label={t.squad.title}>
              {friends.slice(0, 6).map((friend) => {
                const identity = identityOf(friend.name);
                return (
                  <button
                    key={friend.id}
                    className="focus-panel__friend n-pressable"
                    type="button"
                    title={`${friend.label} · ${t.squad.wave}`}
                    aria-label={`${friend.label}. ${t.squad.wave}`}
                    onClick={() => onWave?.(friend.id)}
                  >
                    <Mascot mood={friend.mood} shape={identity.shape} color={identity.color} seed={friend.id} size={28} showDot={false} fps={12} />
                    <span>{friend.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageChrome>
  );
}
