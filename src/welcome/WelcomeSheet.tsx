import { useState, type CSSProperties } from "react";
import { useTranslation } from "../i18n";
import { Mascot } from "../mascot/Mascot";
import type { MascotMood } from "../mascot/engine";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import { finishWelcome } from "./welcome";
import "./Welcome.css";

/** Nimbo introduces itself: one mood and one topic colour per step. */
const STEPS: { mood: MascotMood; color: string }[] = [
  { mood: "greeting", color: "#5ac8fa" },
  { mood: "idle", color: "#5e5ce6" },
  { mood: "thinking", color: "#bf8cff" },
  { mood: "waiting", color: "#35e985" },
  { mood: "done", color: "#ffd60a" },
];

export function WelcomeSheet({ onDone }: { onDone: () => void }) {
  const copy = useTranslation().welcome;
  const [step, setStep] = useState(0);
  const last = step === copy.steps.length - 1;
  const current = copy.steps[step];
  const look = STEPS[step % STEPS.length];

  const done = () => {
    finishWelcome();
    onDone();
  };

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome__card" style={{ "--welcome-color": look.color } as CSSProperties}>
        <span className="welcome__eyebrow">{copy.eyebrow}</span>
        <span className="welcome__stage" aria-hidden="true">
          <Mascot mood={look.mood} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={112} glow showDot={false} interactive forceMotion />
        </span>
        <div className="welcome__copy" key={step}>
          <h2 id="welcome-title">{current.title}</h2>
          <p>{current.text}</p>
        </div>
        <div className="welcome__dots" role="tablist" aria-label={copy.eyebrow}>
          {copy.steps.map((item, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === step}
              aria-label={item.title}
              className={index === step ? "welcome__dot welcome__dot--active" : "welcome__dot"}
              onClick={() => setStep(index)}
            />
          ))}
        </div>
        <div className="welcome__actions">
          {!last && (
            <button className="prefs-button prefs-button--quiet" type="button" onClick={done}>
              {copy.skip}
            </button>
          )}
          <button
            className="prefs-button"
            type="button"
            autoFocus
            onClick={() => (last ? done() : setStep(step + 1))}
          >
            {last ? copy.start : copy.next}
          </button>
        </div>
      </div>
    </div>
  );
}
