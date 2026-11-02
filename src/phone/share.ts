/** What the PC shares with the paired phone, kept small and free of noise. */

const MAX_CLIPBOARD = 2_000;

/** The newest copied text (the history already drops passwords, keys and card numbers). */
export function latestCopiedText(items: { kind: string; text?: string; copiedAt: number }[]) {
  const latest = items
    .filter((item) => item.kind === "text" && item.text && item.text.trim())
    .reduce<{ text?: string; copiedAt: number } | null>((best, item) => (!best || item.copiedAt > best.copiedAt ? item : best), null);
  if (!latest?.text) return null;
  return { text: latest.text.slice(0, MAX_CLIPBOARD), copiedAt: latest.copiedAt };
}

const FRIENDLY: [RegExp, string][] = [
  [/^chrome\.exe$/i, "Chrome"],
  [/^msedge\.exe$/i, "Edge"],
  [/^firefox\.exe$/i, "Firefox"],
  [/^code\.exe$/i, "VS Code"],
  [/^cursor\.exe$/i, "Cursor"],
  [/^winword\.exe$/i, "Word"],
  [/^excel\.exe$/i, "Excel"],
  [/^powerpnt\.exe$/i, "PowerPoint"],
  [/^notion\.exe$/i, "Notion"],
  [/^spotify\.exe$/i, "Spotify"],
  [/^explorer\.exe$/i, "Explorador de Arquivos"],
  [/^acrobat\.exe$|^acrord32\.exe$/i, "Acrobat"],
  [/^windowsterminal\.exe$/i, "Terminal"],
];

/** Browsers and editors add their own name to the title: " - Google Chrome", " — Visual Studio Code". */
const TITLE_SUFFIX = /\s+[-–—]\s+(google chrome|microsoft edge|mozilla firefox|visual studio code|cursor|word|excel|powerpoint|notion)$/i;

export function activityOfWindow(app: string, title: string): { app: string; title: string } | null {
  const name = FRIENDLY.find(([pattern]) => pattern.test(app))?.[1] ?? app.replace(/\.exe$/i, "");
  if (!name || /^(nimbo|searchhost|shellexperiencehost|lockapp)$/i.test(name)) return null;
  const clean = title.replace(TITLE_SUFFIX, "").replace(/\s+[-–—]\s+(perfil|profile)\s+\d+$/i, "").trim();
  return { app: name, title: clean.slice(0, 160) };
}
