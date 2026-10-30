import { isTauri } from "@tauri-apps/api/core";

/**
 * Design preview for the music page: open the Vite dev server in a browser with
 * `?demo=music` to see the player with a sample track, cover and lyrics.
 * Never active in the desktop app or in production builds.
 */
export const MUSIC_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "music";

const DEMO_STARTED_AT = Date.now();

export const DEMO_TRACK = {
  title: "Céu de Setembro",
  artist: "Lia Moraes",
  albumTitle: "Horizonte",
  durationMs: 214_000,
  positionMs: 96_000,
  startedAt: DEMO_STARTED_AT,
};

/** Abstract cover drawn as SVG, so the demo needs no image files. */
export const DEMO_ARTWORK = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
  <defs>
    <radialGradient id="sun" cx="34%" cy="38%" r="46%">
      <stop offset="0" stop-color="#ffd27a"/>
      <stop offset="0.45" stop-color="#ff7a59"/>
      <stop offset="1" stop-color="#ff7a59" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b1f4b"/>
      <stop offset="1" stop-color="#5a2a6e"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#sky)"/>
  <circle cx="102" cy="114" r="140" fill="url(#sun)"/>
  <path d="M0 220 Q 80 180 150 214 T 300 200 V300 H0Z" fill="#0f1230" opacity="0.85"/>
  <path d="M0 250 Q 90 222 170 246 T 300 236 V300 H0Z" fill="#090a1f"/>
</svg>`)}`;

/** Invented lines (not a real song) to preview synced lyrics. */
export const DEMO_LYRICS = [
  "[01:20.00]O vento trouxe o seu nome",
  "[01:25.00]pela janela do quarto",
  "[01:30.00]e o céu ficou laranja",
  "[01:35.00]como quem guarda um segredo",
  "[01:40.00]eu conto os dias de setembro",
  "[01:45.00]nas linhas da sua mão",
  "[01:50.00]e cada nuvem que passa",
  "[01:55.00]desenha a mesma canção",
  "[02:00.00]fica mais um pouco",
  "[02:05.00]que a noite ainda é cedo",
].join("\n");
