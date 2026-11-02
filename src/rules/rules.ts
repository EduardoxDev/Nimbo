/**
 * Trigger rules written as sentences: "quando conectar o fone, toca minha
 * playlist", "quando a bateria chegar a 20%, me avisa de carregar".
 * A rule fires once when its trigger becomes true, not while it stays true.
 */

export type Trigger =
  | { kind: "headphones" }
  | { kind: "battery"; below: number }
  | { kind: "charging" }
  | { kind: "wifi"; ssid: string }
  | { kind: "app"; app: string }
  | { kind: "time"; time: string };

export type Action =
  | { kind: "music"; query: string }
  | { kind: "pause" }
  | { kind: "focus" }
  | { kind: "routine"; routine: "start" | "end" }
  | { kind: "ac"; on: boolean; temperature: number | null }
  | { kind: "dark"; on: boolean }
  | { kind: "open"; app: string }
  | { kind: "macro"; name: string }
  | { kind: "notify"; text: string };

export type Rule = { id: string; text: string; enabled: boolean; trigger: Trigger; action: Action };
export type RuleContext = { headphones: boolean; battery: number | null; charging: boolean; ssid: string | null; app: string; time: string };

export const RULES_KEY = "nimbo-rules";

const HEADPHONES = /fone|headphone|headset|earphone|earbud|airpods|buds|auricular|耳机/i;

export function isHeadphones(output: string | null) {
  return !!output && HEADPHONES.test(output);
}

function fold(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function triggerActive(trigger: Trigger, context: RuleContext): boolean {
  switch (trigger.kind) {
    case "headphones":
      return context.headphones;
    case "battery":
      return context.battery !== null && !context.charging && context.battery <= trigger.below;
    case "charging":
      return context.charging;
    case "wifi":
      return !!context.ssid && fold(context.ssid) === fold(trigger.ssid);
    case "app":
      return !!context.app && fold(context.app).includes(fold(trigger.app).replace(/\s+/g, ""));
    case "time":
      return context.time === trigger.time;
  }
}

/** Rules whose trigger just turned true. Nothing fires on the very first look. */
export function firedRules(rules: Rule[], previous: RuleContext | null, current: RuleContext): Rule[] {
  if (!previous) return [];
  return rules.filter((rule) => rule.enabled && triggerActive(rule.trigger, current) && !triggerActive(rule.trigger, previous));
}

export function parseRules(raw: string | null): Rule[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Rule => !!item && typeof item.id === "string" && typeof item.text === "string" && !!item.trigger && !!item.action).slice(0, 40)
      : [];
  } catch {
    return [];
  }
}

function parseTrigger(text: string, ssid: string | null): Trigger | null {
  const t = fold(text);
  if (/(conect|lig|plug|coloc|pluga)\w*\s+(o |os |meu |meus )?(fone|headset|airpods|buds)|(connect|plug in|put on)\s+(my |the )?(headphones|headset|airpods|earbuds)/.test(t)) return { kind: "headphones" };
  const battery = /bateria\s+(?:chegar|ficar|estiver|baixar|cair|for)?\s*(?:a|em|abaixo de|para|menos de|<)?\s*(\d{1,2})\s*%?|battery\s+(?:drops?|gets?|is|reaches|hits|falls)?\s*(?:below|under|to|at)?\s*(\d{1,2})\s*%?/.exec(t);
  if (battery) return { kind: "battery", below: Number(battery[1] ?? battery[2]) };
  if (/(conect|lig|plug)\w*\s+(o )?carregador|na tomada|plug in the charger|start(s)? charging|charger is (plugged|connected)/.test(t)) return { kind: "charging" };
  if (/chegar em casa|eu chegar em casa|arrive home|get home/.test(t)) return ssid ? { kind: "wifi", ssid } : null;
  const wifi = /(?:conectar|entrar|estiver)\s+(?:n[oa]\s+)?wi-?fi\s+(.+)|connect(?:ed)? to (?:the )?(.+?) wi-?fi|on (?:the )?(.+?) wi-?fi/.exec(t);
  if (wifi) return { kind: "wifi", ssid: (wifi[1] ?? wifi[2] ?? wifi[3]).trim() };
  const time = /(?:todo dia|todos os dias|every day|daily)?\s*(?:as|a|at)\s+(\d{1,2})(?:\s*[:h]\s*(\d{2}))?\s*(am|pm|h)?$/.exec(t);
  if (time) {
    let hour = Number(time[1]);
    if (time[3] === "pm" && hour < 12) hour += 12;
    const minute = Number(time[2] ?? 0);
    if (hour < 24 && minute < 60) return { kind: "time", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
  }
  const app = /^(?:eu\s+)?(?:abrir|abro|abrir o|abrir a)\s+(?:o\s+|a\s+)?(.+)$|^(?:i\s+)?open\s+(?:the\s+)?(.+)$/.exec(t);
  if (app) return { kind: "app", app: (app[1] ?? app[2]).trim() };
  return null;
}

function parseAction(text: string): Action | null {
  const original = text.trim().replace(/[.!]+$/, "");
  const t = fold(original);
  if (/^(?:comecar|comeca|inicia|iniciar)\s+o dia|^bom dia|^start (?:my|the) day/.test(t)) return { kind: "routine", routine: "start" };
  if (/^(?:encerrar|encerra|terminar|termina)\s+o dia|^boa noite|^end (?:my|the) day/.test(t)) return { kind: "routine", routine: "end" };
  if (/^(?:pausa|pausar|pause|para a musica|parar a musica|stop the music)/.test(t)) return { kind: "pause" };
  if (/(?:comeca|comecar|inicia|iniciar|start)\s+(?:um |o |a )?(?:foco|focus|pomodoro)/.test(t)) return { kind: "focus" };
  const acOn = /^(?:liga|ligar|turn on)\s+(?:o\s+)?(?:ar|ac|a\/c|ar-condicionado|ar condicionado|the ac|the air conditioner)(?:\s+(?:em|no|a|at|to)\s+(\d{2}))?/.exec(t);
  if (acOn) return { kind: "ac", on: true, temperature: acOn[1] ? Number(acOn[1]) : null };
  if (/^(?:desliga|desligar|turn off)\s+(?:o\s+)?(?:ar|ac|ar-condicionado|ar condicionado|the ac|the air conditioner)/.test(t)) return { kind: "ac", on: false, temperature: null };
  if (/(?:ativa|ativar|liga|ligar|turn on)\s+(?:o\s+)?(?:modo escuro|dark mode)/.test(t)) return { kind: "dark", on: true };
  if (/(?:desativa|desativar|desliga|desligar|turn off)\s+(?:o\s+)?(?:modo escuro|dark mode)/.test(t)) return { kind: "dark", on: false };
  const play = /^(?:toca|tocar|toque|bota|coloca|play|put on)\s+(.+)$/.exec(original);
  if (play) {
    const query = play[1].trim();
    return { kind: "music", query: /^(?:minha (?:playlist|musica)|musica|uma musica|my (?:playlist|music)|music|something)$/i.test(fold(query)) ? "" : query };
  }
  const open = /^(?:abre|abrir|abra|open)\s+(?:o\s+|a\s+|the\s+)?(.+)$/i.exec(original);
  if (open) return { kind: "open", app: open[1].trim() };
  const run = /^(?:roda|rodar|rode|executa|executar|faz|fazer|run|do)\s+(?:o\s+|a\s+|the\s+)?(?:a[cç][aã]o\s+|action\s+)?(.+)$/i.exec(original);
  if (run) return { kind: "macro", name: run[1].trim() };
  const notify = /^(?:me\s+)?(?:avisa|avise|lembra|lembre|notify me|remind me|tell me)(?:\s+(?:de|que|para|pra|to|about|that))?\s+(.+)$/i.exec(original);
  if (notify) return { kind: "notify", text: notify[1].trim() };
  return null;
}

/** "quando <gatilho>, <ação>" or "when <trigger>, <action>". */
export function parseRule(text: string, currentSsid: string | null): Omit<Rule, "id" | "enabled"> | null {
  const match =
    /^(?:quando|sempre que|assim que|when|whenever)\s+(.+?)\s*(?:,|\s+ent[aã]o\s+|\s+then\s+)\s*(.+)$/i.exec(text.trim()) ??
    // "todo dia às 9h, começar o dia" has no "quando".
    /^((?:todo dia|todos os dias|every day|daily)\s+.+?)\s*,\s*(.+)$/i.exec(text.trim());
  if (!match) return null;
  const trigger = parseTrigger(match[1], currentSsid);
  const action = parseAction(match[2]);
  return trigger && action ? { text: text.trim(), trigger, action } : null;
}
