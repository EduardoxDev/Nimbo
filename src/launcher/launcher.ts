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

export type DayRequest = "today" | "xray" | "diary" | "plan";

/** "meu dia", "raio-x", "diário", "planejar meu dia" open the My day window. */
export function dayRequestOf(query: string): DayRequest | null {
  const text = query.trim().toLowerCase();
  if (/^(meu dia|linha do tempo|o que (eu )?fiz( hoje| ontem)?\??|my day|timeline|what did i do( today| yesterday)?\??|我的一天|时间线)$/.test(text)) return "today";
  if (/^(raio-?x( do tempo)?|tempo nos apps|meu tempo|time x-?ray|screen time|时间分析)$/.test(text)) return "xray";
  if (/^(di[aá]rio( do dia)?|resumo do dia|diary|journal|日记)$/.test(text)) return "diary";
  if (/^(planejar|planeja|organizar|organiza)( o| meu)? dia$|^plan( my| the)? day$|^规划(今天|一天)$/.test(text)) return "plan";
  return null;
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
