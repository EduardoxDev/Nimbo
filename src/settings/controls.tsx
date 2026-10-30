import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

/** Building blocks of the settings window: grouped cards and their controls. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prefs-section">
      <h2>{title}</h2>
      <div className="prefs-card">{children}</div>
    </section>
  );
}

export function Row({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="prefs-row">
      <div className="prefs-row__text">
        <span className="prefs-row__title">{title}</span>
        {hint && <span className="prefs-row__hint">{hint}</span>}
      </div>
      {children && <div className="prefs-row__control">{children}</div>}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`prefs-toggle${checked ? " prefs-toggle--on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="prefs-toggle__knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="prefs-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className={`prefs-segmented__option${option.value === value ? " prefs-segmented__option--active" : ""}`}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  step,
  format,
  decreaseLabel,
  increaseLabel,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="prefs-stepper">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus size={13} strokeWidth={3} />
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus size={13} strokeWidth={3} />
      </button>
    </div>
  );
}
