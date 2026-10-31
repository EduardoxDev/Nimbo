import { useState } from "react";
import { CalendarDays, MousePointerClick, Settings } from "lucide-react";
import { useTranslation } from "../i18n";
import { finishWelcome } from "./welcome";
import "./Welcome.css";

const ICONS = [MousePointerClick, CalendarDays, Settings];
const COLORS = ["#5e5ce6", "#ff453a", "#8e8e93"];

export function WelcomeSheet({ onDone }: { onDone: () => void }) {
  const copy = useTranslation().welcome;
  const [step, setStep] = useState(0);
  const last = step === copy.steps.length - 1;
  const Icon = ICONS[step];
  const current = copy.steps[step];

  const done = () => {
    finishWelcome();
    onDone();
  };

  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome__card">
        <span className="welcome__eyebrow">{copy.eyebrow}</span>
        <span className="welcome__tile" style={{ background: COLORS[step] }} aria-hidden="true">
          <Icon size={30} strokeWidth={2.2} />
        </span>
        <h2 id="welcome-title">{current.title}</h2>
        <p>{current.text}</p>
        <div className="welcome__dots" aria-hidden="true">
          {copy.steps.map((_, index) => (
            <span key={index} className={index === step ? "welcome__dot welcome__dot--active" : "welcome__dot"} />
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
