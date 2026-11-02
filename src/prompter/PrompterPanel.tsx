import { useEffect, useRef, useState } from "react";
import { Minus, Pause, Play, Plus, ScrollText, Square, Type } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { clampWpm, formatDuration, loadPrompter, PROMPTER_KEY, readingSeconds, scrollSpeed, wordCount, type PrompterState } from "./prompter";
import "./Prompter.css";

type Run = "editing" | "countdown" | "playing" | "paused";

/**
 * Teleprompter: the island sits next to the webcam, so reading the script
 * here keeps your eyes on the camera. Space pauses, ↑/↓ change the pace, Esc stops.
 */
export function PrompterPanel<Page extends string>({
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const copy = useTranslation().prompter;
  const [state, setState] = useState<PrompterState>(loadPrompter);
  const [run, setRun] = useState<Run>("editing");
  const [count, setCount] = useState(3);
  const viewportRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    try {
      window.localStorage.setItem(PROMPTER_KEY, JSON.stringify(state));
    } catch {
      // Kept for this run only.
    }
  }, [state]);

  const setWpm = (wpm: number) => setState((current) => ({ ...current, wpm: clampWpm(wpm) }));
  const setFont = (fontSize: number) => setState((current) => ({ ...current, fontSize: Math.min(44, Math.max(16, fontSize)) }));
  const place = () => {
    if (textRef.current) textRef.current.style.transform = `translateY(${-offsetRef.current}px)`;
  };
  const stop = () => {
    offsetRef.current = 0;
    setRun("editing");
  };

  // 3, 2, 1… then roll.
  useEffect(() => {
    if (run !== "countdown") return;
    if (count === 0) {
      setRun("playing");
      return;
    }
    const timer = window.setTimeout(() => setCount((value) => value - 1), 700);
    return () => window.clearTimeout(timer);
  }, [run, count]);

  // The scroll itself: one frame at a time, at the pace that reads the script in its time.
  useEffect(() => {
    if (run !== "playing") return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const text = textRef.current;
      const viewport = viewportRef.current;
      if (text && viewport) {
        // Only the words count for the pace, not the empty space above and below them.
        const style = getComputedStyle(text);
        const padTop = parseFloat(style.paddingTop) || 0;
        const words = text.scrollHeight - padTop - (parseFloat(style.paddingBottom) || 0);
        const end = padTop + words - viewport.clientHeight * 0.26;
        const speed = scrollSpeed(words, stateRef.current.script, stateRef.current.wpm);
        offsetRef.current = Math.min(end, offsetRef.current + (speed * (now - last)) / 1000);
        place();
        if (offsetRef.current >= end) {
          setRun("paused");
          return;
        }
      }
      last = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [run]);

  useEffect(() => {
    if (run === "editing") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " ") {
        event.preventDefault();
        setRun((current) => (current === "playing" ? "paused" : current === "paused" ? "playing" : current));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setWpm(stateRef.current.wpm + 10);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setWpm(stateRef.current.wpm - 10);
      } else if (event.key === "Escape") {
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  const seconds = readingSeconds(state.script, state.wpm);
  const words = wordCount(state.script);

  return (
    <PageChrome
      icon={ScrollText}
      iconColor="#64d2ff"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className={`prompter prompter--${run}`}
      label={copy.title}
    >
      {run === "editing" ? (
        <div className="prompter__editor">
          <textarea
            className="prompter__script"
            value={state.script}
            placeholder={copy.placeholder}
            aria-label={copy.title}
            data-window-drag="false"
            onChange={(event) => setState((current) => ({ ...current, script: event.target.value.slice(0, 50_000) }))}
          />
          <div className="prompter__bar">
            <span className="prompter__meta">{words > 0 ? copy.meta(words, formatDuration(seconds)) : copy.empty}</span>
            <span className="prompter__steps" aria-label={copy.pace}>
              <button type="button" aria-label={copy.slower} title={copy.slower} onClick={() => setWpm(state.wpm - 10)}>
                <Minus size={13} strokeWidth={2.6} />
              </button>
              <span>{copy.wpm(state.wpm)}</span>
              <button type="button" aria-label={copy.faster} title={copy.faster} onClick={() => setWpm(state.wpm + 10)}>
                <Plus size={13} strokeWidth={2.6} />
              </button>
            </span>
            <span className="prompter__steps" aria-label={copy.size}>
              <button type="button" aria-label={copy.smaller} title={copy.smaller} onClick={() => setFont(state.fontSize - 2)}>
                <Type size={11} strokeWidth={2.6} />
              </button>
              <button type="button" aria-label={copy.bigger} title={copy.bigger} onClick={() => setFont(state.fontSize + 2)}>
                <Type size={15} strokeWidth={2.6} />
              </button>
            </span>
            <button
              className="prompter__start n-pressable"
              type="button"
              disabled={words === 0}
              onClick={() => {
                offsetRef.current = 0;
                setCount(3);
                setRun("countdown");
              }}
            >
              <Play size={14} fill="currentColor" strokeWidth={0} />
              {copy.start}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="prompter__stage"
          ref={viewportRef}
          data-window-drag="false"
          onWheel={(event) => {
            offsetRef.current = Math.max(0, offsetRef.current + event.deltaY * 0.6);
            place();
          }}
        >
          <div className="prompter__text" ref={textRef} style={{ fontSize: state.fontSize }}>
            {state.script}
          </div>
          <span className="prompter__line" aria-hidden="true" />
          {run === "countdown" && <span className="prompter__count">{count}</span>}
          <div className="prompter__controls">
            <button
              type="button"
              aria-label={run === "playing" ? copy.pause : copy.resume}
              title={`${run === "playing" ? copy.pause : copy.resume} (${copy.space})`}
              onClick={() => setRun((current) => (current === "playing" ? "paused" : "playing"))}
            >
              {run === "playing" ? <Pause size={14} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} />}
            </button>
            <button type="button" aria-label={copy.slower} title={`${copy.slower} (↓)`} onClick={() => setWpm(state.wpm - 10)}>
              <Minus size={13} strokeWidth={2.6} />
            </button>
            <span>{copy.wpm(state.wpm)}</span>
            <button type="button" aria-label={copy.faster} title={`${copy.faster} (↑)`} onClick={() => setWpm(state.wpm + 10)}>
              <Plus size={13} strokeWidth={2.6} />
            </button>
            <button type="button" aria-label={copy.stop} title={`${copy.stop} (Esc)`} onClick={stop}>
              <Square size={12} fill="currentColor" strokeWidth={0} />
            </button>
          </div>
        </div>
      )}
    </PageChrome>
  );
}
