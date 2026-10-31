import { useState } from "react";
import { CalendarDays, Droplet, ListTodo, Music, Timer, type LucideIcon } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { IslandBar } from "../island/PageChrome";
import { Mascot } from "../mascot/Mascot";
import type { MascotMood, MascotShape } from "../mascot/engine";
import { NIMBO_COLOR, STATUS_COLORS } from "../mascot/nimboMood";
import "./Hub.css";

export type HubLine = { key: string; icon: LucideIcon; text: string };
export type HubPill = { key: "music" | "calendar" | "focus" | "water"; text: string; active: boolean };
export type HubProgress = { label: string; progress: number; detail: string } | null;
export type HubAgent = { id: string; name: string; text: string; mood: MascotMood; shape: MascotShape; color: string };

const PILL_ICONS: Record<HubPill["key"], LucideIcon> = { music: Music, calendar: CalendarDays, focus: Timer, water: Droplet };
const PILL_SHAPES: Record<HubPill["key"], MascotShape> = { music: "blob", calendar: "pebble", focus: "drop", water: "round" };

export const HUB_LINE_ICONS = { music: Music, calendar: CalendarDays, todo: ListTodo, focus: Timer, water: Droplet };

export function HubPanel<Page extends string>({
  mood,
  lines,
  pills,
  agents,
  progress,
  pages,
  currentPage,
  onPageChange,
  onOpen,
}: {
  mood: MascotMood;
  lines: HubLine[];
  pills: HubPill[];
  agents: HubAgent[];
  progress: HubProgress;
  pages: IslandTab<Page>[];
  currentPage: Page;
  onPageChange: (page: Page) => void;
  onOpen: (key: HubPill["key"] | "agents") => void;
}) {
  const copy = useTranslation().hub;
  const [dizzy, setDizzy] = useState(false);
  const busy = pills.some((pill) => pill.active) || lines.length > 0 || agents.length > 0;

  const handleReaction = (reaction: "dizzy" | "annoyed") => {
    if (reaction !== "dizzy") return;
    setDizzy(true);
    window.setTimeout(() => setDizzy(false), 4_500);
  };

  const mascot = (size: number, shownMood: MascotMood) => (
    <Mascot mood={shownMood} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={size} glow interactive onReaction={handleReaction} label="Nimbo" />
  );

  const side = (
    <div className="hub__column g-card" aria-hidden="true">
      {pills.map((pill) => (
        <Mascot key={pill.key} mood={pill.active ? "working" : "idle"} shape={PILL_SHAPES[pill.key]} color={STATUS_COLORS[pill.key]} seed={pill.key} size={18} showDot={false} />
      ))}
    </div>
  );

  return (
    <section className="island-page hub-panel" aria-label={copy.title}>
      <IslandBar pages={pages} currentPage={currentPage} onPageChange={onPageChange} />
      {dizzy ? (
        <div className="hub hub--wide">
          <div className="hub__card hub__card--dizzy g-card">
            {mascot(58, "dizzy")}
            <p className="hub__message">{copy.dizzy}</p>
          </div>
          {side}
        </div>
      ) : progress ? (
        <div className="hub hub--wide">
          <div className="hub__card hub__card--progress g-card">
            <div className="hub__progress-head">
              <Timer size={13} strokeWidth={2.4} aria-hidden="true" />
              <span>{progress.label}</span>
              <strong>{Math.round(progress.progress * 100)}%</strong>
            </div>
            <div className="hub__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress * 100)} aria-label={progress.label}>
              <span className="hub__fill" style={{ width: `${progress.progress * 100}%` }} />
              <span className="hub__rider" style={{ left: `${progress.progress * 100}%` }}>
                {mascot(30, mood === "waiting" ? "waiting" : "working")}
              </span>
            </div>
            <span className="hub__detail">{progress.detail}</span>
          </div>
          {side}
        </div>
      ) : !busy ? (
        <div className="hub hub--single">
          <div className="hub__card hub__card--greeting g-card">
            {mascot(64, mood === "idle" ? "greeting" : mood)}
            <div className="hub__greeting">
              <strong>{copy.greeting}</strong>
              <span>{copy.calm}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="hub hub--split">
          <div className="hub__card hub__card--focus g-card">
            {mascot(62, mood)}
            <ul className="hub__lines">
              {lines.slice(0, 3).map((line, index) => {
                const Icon = line.icon;
                return (
                  <li key={line.key} className={index === 0 ? "hub__line hub__line--current" : "hub__line"}>
                    <Icon size={index === 0 ? 14 : 12} strokeWidth={2.2} aria-hidden="true" />
                    <span>{line.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="hub__pills g-card">
            {agents.length > 0 && agents.slice(0, 4).map((agent) => (
              <button key={agent.id} className="g-pill hub__pill" type="button" title={`${agent.name}: ${agent.text}`} onClick={() => onOpen("agents")}>
                <Mascot mood={agent.mood} shape={agent.shape} color={agent.color} seed={agent.name} size={18} showDot={false} glow />
                <span>{agent.text}</span>
              </button>
            ))}
            {agents.length === 0 && pills.map((pill) => {
              const Icon = PILL_ICONS[pill.key];
              return (
                <button
                  key={pill.key}
                  className={`g-pill hub__pill hub__pill--${pill.key}${pill.active ? " hub__pill--active" : ""}`}
                  type="button"
                  title={pill.text}
                  onClick={() => onOpen(pill.key)}
                >
                  {pill.active ? (
                    <Mascot mood="working" shape={PILL_SHAPES[pill.key]} color={STATUS_COLORS[pill.key]} seed={pill.key} size={18} showDot={false} glow />
                  ) : (
                    <span className="hub__pill-icon" style={{ color: STATUS_COLORS[pill.key] }}>
                      <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                  )}
                  <span>{pill.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
