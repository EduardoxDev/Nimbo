export type LauncherApp = { name: string; id: string };

const MAX_RESULTS = 7;

function fold(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function score(name: string, query: string) {
  if (name.startsWith(query)) return 0;
  if (name.split(/[\s\-_.()]+/).some((word) => word.startsWith(query))) return 1;
  if (name.includes(query)) return 2;
  let position = 0;
  for (const char of query) {
    position = name.indexOf(char, position);
    if (position < 0) return null;
    position += 1;
  }
  return 3;
}

export function isClipRequest(query: string) {
  return /^(grav(a|ar|e)\s+(os\s+)?[uú]ltimos\s+30\s+segundos|clipe?|record that|clip that|grava isso|剪辑)$/i.test(query.trim());
}

export function searchApps(apps: LauncherApp[], query: string): LauncherApp[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  return apps
    .map((app) => ({ app, rank: score(fold(app.name), needle) }))
    .filter((item): item is { app: LauncherApp; rank: number } => item.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.app.name.length - b.app.name.length || a.app.name.localeCompare(b.app.name))
    .slice(0, MAX_RESULTS)
    .map((item) => item.app);
}
