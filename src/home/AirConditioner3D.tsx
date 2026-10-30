import { useId } from "react";

type AirMode = "cool" | "heat" | "fan" | "off";

/** Maps Home Assistant hvac modes to how the air looks. */
export function airModeOf(state: string): AirMode {
  if (state === "off") return "off";
  if (state === "heat") return "heat";
  if (state === "fan_only") return "fan";
  return "cool";
}

/**
 * A small wall-mounted air conditioner drawn in SVG: the flap opens and air
 * flows out while it runs (snow when cooling, warm ripples when heating).
 */
export function AirConditioner3D({
  mode,
  display,
  label,
}: {
  mode: AirMode;
  /** Text on the unit's little screen, e.g. "22°". */
  display: string;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  const isOn = mode !== "off";

  return (
    <svg
      className={`ac3d ac3d--${mode}`}
      viewBox="0 0 180 112"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#eef1f7" />
          <stop offset="1" stopColor="#d5dbe6" />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#1b2335" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f8fc" />
          <stop offset="1" stopColor="#c9d0dd" />
        </linearGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-flow`}>
          <rect x="0" y="52" width="180" height="60" fill={`url(#${id}-fade)`} />
        </mask>
        <filter id={`${id}-shadow`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Soft shadow on the wall behind the unit. */}
      <rect x="16" y="22" width="152" height="40" rx="14" fill="#000" opacity="0.4" filter={`url(#${id}-shadow)`} />

      {/* Air flow, drawn first so the body covers its start. */}
      {isOn && (
        <g className="ac3d__flow" mask={`url(#${id}-flow)`}>
          <path d="M44 54 C 38 68, 50 80, 42 104" />
          <path d="M74 54 C 70 70, 80 84, 72 108" />
          <path d="M106 54 C 102 70, 112 84, 104 108" />
          <path d="M136 54 C 132 68, 142 80, 134 104" />
          {mode === "cool" &&
            [52, 88, 120, 146, 66, 100].map((x, index) => (
              <circle key={x} className="ac3d__flake" cx={x} cy="58" r={index % 2 ? 1.4 : 1.9} />
            ))}
        </g>
      )}

      {/* Top face: the 3D lid. */}
      <path d="M22 9 H158 Q170 9 170 19 V20 H10 V19 Q10 9 22 9 Z" fill={`url(#${id}-top)`} />
      {/* Front face. */}
      <rect x="10" y="14" width="160" height="40" rx="12" fill={`url(#${id}-front)`} />
      <rect x="10" y="14" width="160" height="40" rx="12" fill={`url(#${id}-side)`} />
      <path d="M22 14.6 H158" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />

      {/* Air outlet and its flap. */}
      <rect x="22" y="43" width="136" height="8" rx="4" fill="#1a1f2c" />
      <rect className="ac3d__flap" x="22" y="43" width="136" height="5.5" rx="2.75" fill="#cdd3df" />

      {/* Brand, power light and the little screen. */}
      <text x="34" y="32.5" className="ac3d__brand">nimbo</text>
      <circle className="ac3d__led" cx="26" cy="30" r="2.1" />
      <rect x="116" y="21.5" width="38" height="15" rx="4.5" fill="#0d111c" />
      <text x="135" y="32.6" className="ac3d__display" filter={isOn ? `url(#${id}-glow)` : undefined}>
        {isOn ? display : "--"}
      </text>
    </svg>
  );
}
