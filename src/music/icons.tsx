import type { ExternalService } from "./catalog";

/* Transport glyphs with rounded corners: lucide's filled shapes come out sharp. */

export function PlayGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 5.6c0-1.2 1.3-1.9 2.3-1.3l9.2 5.9a1.6 1.6 0 0 1 0 2.7l-9.2 5.9c-1 .6-2.3-.1-2.3-1.3z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        transform="translate(-0.8 0)"
      />
    </svg>
  );
}

export function PauseGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6" y="4.5" width="4.4" height="15" rx="1.6" />
      <rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6" />
    </svg>
  );
}

export function SkipGlyph({ size = 20, back = false }: { size?: number; back?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={back ? { transform: "scaleX(-1)" } : undefined}>
      <path
        d="M5 6.4c0-1 1.1-1.6 1.9-1l7.5 5.3c.7.5.7 1.6 0 2.1l-7.5 5.3c-.8.6-1.9 0-1.9-1z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="16.4" y="5" width="2.8" height="14" rx="1.4" fill="currentColor" />
    </svg>
  );
}

/** Small marks for the "play the full song" services, drawn from simple shapes. */
export function ServiceMark({ service, size = 18 }: { service: ExternalService; size?: number }) {
  if (service === "spotify" || service === "spotifyWeb") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#1ed760" />
        <g fill="none" stroke="#08080a" strokeLinecap="round">
          <path d="M6.2 9.2c3.9-1.2 8.2-.9 11.6.9" strokeWidth="2" />
          <path d="M7 12.5c3.2-.9 6.6-.6 9.4.8" strokeWidth="1.7" />
          <path d="M7.7 15.6c2.5-.6 5-.4 7.2.6" strokeWidth="1.4" />
        </g>
      </svg>
    );
  }
  if (service === "youtube") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#ff0033" />
        <circle cx="12" cy="12" r="5.6" fill="none" stroke="#fff" strokeWidth="1.4" />
        <path d="M10.6 9.6v4.8l4-2.4z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="7" fill="#a238ff" />
      <g fill="#fff">
        <rect x="5" y="14" width="2.6" height="4" rx="1" />
        <rect x="8.6" y="11" width="2.6" height="7" rx="1" />
        <rect x="12.2" y="8" width="2.6" height="10" rx="1" />
        <rect x="15.8" y="5" width="2.6" height="13" rx="1" />
      </g>
    </svg>
  );
}
