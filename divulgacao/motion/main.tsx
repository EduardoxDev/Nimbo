import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import {
  AppWindow,
  Bot,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Droplets,
  House,
  Languages,
  Mic,
  ScanText,
  Smartphone,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Mascot } from "../../src/mascot/Mascot";
import { NIMBO_COLOR } from "../../src/mascot/nimboMood";
import { I18nProvider } from "../../src/i18n";
import musicHome from "./assets/music-home.jpg";
import "./motion.css";

declare global {
  interface Window {
    __t0?: number;
    __motionStart?: () => void;
    __freeze?: number;
  }
}

const BAR = 2.4;
const SCENES = {
  intro: [0, 2 * BAR],
  island: [2 * BAR, 5 * BAR],
  pages: [5 * BAR, 8 * BAR],
  music: [8 * BAR, 10 * BAR],
  automations: [10 * BAR, 13 * BAR],
  more: [13 * BAR, 15 * BAR],
  buddy: [15 * BAR, 17 * BAR],
  outro: [17 * BAR, 20 * BAR],
} as const;
export const DURATION = 20 * BAR;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const outCubic = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const outBack = (value: number) => {
  const x = clamp(value);
  const c = 1.55;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
const inOut = (value: number) => {
  const x = clamp(value);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const ramp = (time: number, start: number, length: number) => clamp((time - start) / length);

function useClock() {
  const [time, setTime] = useState(0);
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const t0 = window.__t0;
      setTime(window.__freeze ?? (t0 === undefined ? 0 : (performance.now() - t0) / 1000));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  return time;
}

function sceneWindow(time: number, [start, end]: readonly [number, number], fade = 0.45) {
  const local = time - start;
  const visible = time >= start - fade && time <= end + fade;
  const enter = ramp(time, start - fade * 0.2, fade);
  const leave = 1 - ramp(time, end - fade * 0.6, fade);
  return { local, visible, opacity: Math.min(enter, leave), leaving: 1 - leave };
}

function Frame({ src, width, height, style, className, onReady }: { src: string; width: number; height: number; style?: CSSProperties; className?: string; onReady?: (doc: Document) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  return (
    <iframe
      ref={ref}
      className={`mo-frame ${className ?? ""}`}
      src={src}
      width={width}
      height={height}
      style={style}
      tabIndex={-1}
      onLoad={() => {
        const doc = ref.current?.contentDocument;
        if (!doc) return;
        const css = doc.createElement("style");
        css.textContent = ":root{color-scheme:normal!important} html,body,#root{background:transparent!important;overflow:hidden!important} *{cursor:none!important}";
        doc.head.appendChild(css);
        onReady?.(doc);
      }}
    />
  );
}

function Caption({ title, text, progress, align = "left", style }: { title: ReactNode; text?: ReactNode; progress: number; align?: "left" | "center"; style?: CSSProperties }) {
  const p = outCubic(progress);
  return (
    <div className={`mo-caption mo-caption--${align}`} style={{ opacity: p, transform: `translateY(${(1 - p) * 26}px)`, ...style }}>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
    </div>
  );
}

function Wallpaper({ shift = 0 }: { shift?: number }) {
  return (
    <div className="mo-wall">
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ transform: `translateY(${shift}px) scale(1.04)` }}>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1424" />
            <stop offset="0.55" stopColor="#27304a" />
            <stop offset="1" stopColor="#6d5a6b" />
          </linearGradient>
          <linearGradient id="far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a4462" />
            <stop offset="1" stopColor="#262d43" />
          </linearGradient>
          <linearGradient id="near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a2033" />
            <stop offset="1" stopColor="#0c0f19" />
          </linearGradient>
        </defs>
        <rect width="1920" height="1080" fill="url(#sky)" />
        <circle cx="1420" cy="600" r="110" fill="#f3c7a6" opacity="0.1" />
        <path d="M0 760 L220 600 L380 690 L560 520 L760 680 L930 560 L1120 700 L1320 540 L1520 660 L1720 560 L1920 640 L1920 1080 L0 1080Z" fill="url(#far)" />
        <path d="M0 880 L260 740 L470 830 L700 700 L960 860 L1200 740 L1440 850 L1680 760 L1920 820 L1920 1080 L0 1080Z" fill="url(#near)" />
      </svg>
    </div>
  );
}

function Cursor({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <svg className="mo-cursor" width="34" height="34" viewBox="0 0 24 24" style={{ transform: `translate(${x}px, ${y}px) scale(${1 - press * 0.12})` }}>
      <path d="M4 2.5 19.5 12l-6.6 1.4L9.6 20z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function Intro({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.intro);
  if (!s.visible) return null;
  const pop = outBack(ramp(s.local, 0.35, 0.8));
  const word = outCubic(ramp(s.local, 1.0, 0.7));
  const tag = outCubic(ramp(s.local, 1.7, 0.7));
  return (
    <section className="mo-scene mo-intro" style={{ opacity: s.opacity }}>
      <div className="mo-glow" style={{ opacity: 0.5 + pop * 0.5 }} />
      <div className="mo-intro__mascot" style={{ transform: `scale(${pop}) translateY(${(1 - pop) * 30}px)`, opacity: clamp(pop) }}>
        <Mascot mood={s.local > 2.2 ? "greeting" : "idle"} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={220} showDot={false} forceMotion glow />
      </div>
      <h1 className="mo-intro__word" style={{ opacity: word, transform: `translateY(${(1 - word) * 24}px)`, letterSpacing: `${-0.04 + (1 - word) * 0.08}em` }}>
        Nimbo
      </h1>
      <p className="mo-intro__tag" style={{ opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>
        A ilha do seu Windows.
      </p>
    </section>
  );
}

function Island({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.island);
  const open = inOut(ramp(s.local, 3.4, 0.7));
  const moveIn = inOut(ramp(s.local, 1.6, 1.6));
  const cursorX = 1500 - moveIn * 540;
  const cursorY = 900 - moveIn * 840;
  const press = ramp(s.local, 3.2, 0.12) * (1 - ramp(s.local, 3.45, 0.15));
  return (
    <section className="mo-scene" style={{ opacity: s.visible ? s.opacity : 0, visibility: s.visible ? "visible" : "hidden" }}>
      <Wallpaper shift={-s.local * 4} />
      <div className="mo-island" style={{ transform: "translateX(-50%) scale(1.75)" }}>
        <Frame src="/?motion=1" width={1000} height={300} style={{ opacity: 1 - open }} />
        <Frame src="/?demo=hub&motion=1" width={1000} height={300} style={{ opacity: open, transform: `scale(${0.55 + open * 0.45}, ${0.25 + open * 0.75})`, transformOrigin: "50% 0" }} />
      </div>
      <Cursor x={cursorX} y={cursorY} press={press} />
      <Caption progress={ramp(s.local, 0.4, 0.8) * (1 - ramp(s.local, 3.2, 0.4))} title="Fechada, ela é só um fio." text="Discreta no topo da tela, com o mascote e a hora." style={{ bottom: 120 }} />
      <Caption progress={ramp(s.local, 3.7, 0.7)} title="Passou o mouse, ela abre." text="Tarefas, agenda, foco e água num só lugar." style={{ bottom: 120 }} />
    </section>
  );
}

const PAGES = [
  { src: "/?demo=music&motion=1", title: "Sua música", text: "Qualquer player do Windows, com capa, letra e controles." },
  { src: "/?demo=agents&motion=1", title: "Seus agentes de IA", text: "Claude Code, Cursor e Codex pedem aprovação direto na ilha." },
  { src: "/?demo=home&motion=1", title: "Sua casa", text: "Ar-condicionado, luzes e tomadas a um clique." },
];

function Pages({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.pages);
  return (
    <section className="mo-scene" style={{ opacity: s.visible ? s.opacity : 0, visibility: s.visible ? "visible" : "hidden" }}>
      <Wallpaper shift={-20 - s.local * 4} />
      <div className="mo-dim" />
      {PAGES.map((page, index) => {
        const start = index * BAR;
        const enter = outCubic(ramp(s.local, start - 0.1, 0.6));
        const leave = index === PAGES.length - 1 ? 0 : inOut(ramp(s.local, start + BAR - 0.35, 0.5));
        const opacity = enter * (1 - leave);
        return (
          <div key={page.src} className="mo-page" style={{ opacity }}>
            <div className="mo-island" style={{ top: 120, transform: `translateX(-50%) translateY(${(1 - enter) * 60 - leave * 60}px) scale(${1.8 - (1 - enter) * 0.08})` }}>
              <Frame src={page.src} width={1000} height={300} />
            </div>
            <Caption progress={ramp(s.local, start + 0.2, 0.6) * (1 - leave)} align="center" title={page.title} text={page.text} style={{ bottom: 150 }} />
          </div>
        );
      })}
    </section>
  );
}

function Music({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.music);
  if (!s.visible) return null;
  const tilt = inOut(ramp(s.local, 0, 1.4));
  const beat = Math.pow(1 - ((time / 0.6) % 1), 3);
  return (
    <section className="mo-scene mo-split" style={{ opacity: s.opacity }}>
      <div className="mo-glow mo-glow--pink" />
      <Caption progress={ramp(s.local, 0.2, 0.7)} title={<>Nimbo <em className="mo-pink">Music</em></>} text="Um app de música inteiro: músicas completas, letra sincronizada, fila e playlists. De graça." style={{ left: 120, top: 360, width: 560 }} />
      <div className="mo-window" style={{ left: 760, top: 150, width: 1060, transform: `perspective(1800px) rotateY(${(1 - tilt) * -16}deg) rotateX(${(1 - tilt) * 6}deg) scale(${0.92 + tilt * 0.08})`, opacity: outCubic(ramp(s.local, 0, 0.6)) }}>
        <img src={musicHome} alt="" />
      </div>
      <div className="mo-dancer" style={{ transform: `translateY(${-beat * 14}px) rotate(${Math.sin(time * Math.PI / 0.6) * 6}deg) scale(${1 + beat * 0.05})`, opacity: outCubic(ramp(s.local, 0.6, 0.5)) }}>
        <Mascot mood="done" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={150} accessory="headphones" showDot={false} forceMotion />
      </div>
    </section>
  );
}

function Automations({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.automations);
  const docRef = useRef<Document | null>(null);
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current && s.local > 3.6 && docRef.current) {
      const items = docRef.current.querySelectorAll<HTMLButtonElement>(".na-nav__item");
      items[1]?.click();
      switched.current = true;
    }
  });
  const enter = outCubic(ramp(s.local, 0, 0.9));
  return (
    <section className="mo-scene mo-split" style={{ opacity: s.visible ? s.opacity : 0, visibility: s.visible ? "visible" : "hidden" }}>
      <div className="mo-glow mo-glow--amber" />
      <Caption progress={ramp(s.local, 0.2, 0.7)} title={<>Nimbo <em className="mo-amber">Automações</em></>} text={"“Quando eu começar o foco, pausa a música e baixa o volume.” Monte visualmente ou só escreva a frase."} style={{ left: 120, top: 330, width: 560 }} />
      <div className="mo-app" style={{ left: 760, top: 175, transform: `translateY(${(1 - enter) * 40}px) scale(1.02)`, opacity: enter }}>
        <Frame src="/?window=automations&motion=1" width={1040} height={680} onReady={(doc) => (docRef.current = doc)} />
      </div>
    </section>
  );
}

const MORE: { icon: LucideIcon; label: string; tone: [string, string] }[] = [
  { icon: CheckSquare, label: "Tarefas do dia", tone: ["#4fd67b", "#28b052"] },
  { icon: Timer, label: "Pomodoro", tone: ["#ff6b5f", "#e5443a"] },
  { icon: Droplets, label: "Lembrete de água", tone: ["#5cc9f5", "#2a9ed8"] },
  { icon: CalendarDays, label: "Agenda e reuniões", tone: ["#ff6f8e", "#e3446c"] },
  { icon: House, label: "Casa inteligente", tone: ["#ffb03a", "#f58a07"] },
  { icon: Smartphone, label: "Ilha no celular", tone: ["#5b9dff", "#3570ec"] },
  { icon: ClipboardList, label: "Histórico de copiados", tone: ["#a3a3ab", "#77777f"] },
  { icon: Languages, label: "Tradução rápida", tone: ["#7f7cff", "#5653d8"] },
  { icon: ScanText, label: "Lê a tela", tone: ["#b28dff", "#8a5cf0"] },
  { icon: Mic, label: "“Ei Nimbo” por voz", tone: ["#ffd23f", "#f2ae00"] },
];

function More({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.more);
  if (!s.visible) return null;
  return (
    <section className="mo-scene" style={{ opacity: s.opacity }}>
      <Caption progress={ramp(s.local, 0.1, 0.6)} align="center" title="E muito mais." text="Tudo leve, em português e guardado no seu PC." style={{ top: 150 }} />
      <div className="mo-grid">
        {MORE.map((item, index) => {
          const p = outBack(ramp(s.local, 0.45 + index * 0.08, 0.55));
          return (
            <div key={item.label} className="mo-tile" style={{ opacity: clamp(p), transform: `translateY(${(1 - p) * 40}px) scale(${0.85 + p * 0.15})` }}>
              <span className="mo-glyph" style={{ background: `linear-gradient(180deg, ${item.tone[0]}, ${item.tone[1]})` }}>
                <item.icon size={30} strokeWidth={2.1} />
              </span>
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Buddy({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.buddy);
  if (!s.visible) return null;
  const walk = inOut(ramp(s.local, 0.3, 2.2));
  const x = 360 + walk * 820;
  const stepping = s.local > 0.3 && s.local < 2.5;
  const bob = stepping ? Math.abs(Math.sin(s.local * 9)) * 10 : 0;
  const bubble = outBack(ramp(s.local, 2.6, 0.5));
  const typed = "Foco concluído! Bora beber uma água?";
  const chars = Math.floor(clamp((s.local - 2.8) / 1.0) * typed.length);
  return (
    <section className="mo-scene" style={{ opacity: s.opacity }}>
      <Wallpaper shift={-40} />
      <div className="mo-dim mo-dim--soft" />
      <Caption progress={ramp(s.local, 0.1, 0.6)} align="center" title="Nimbo livre" text="O mascote sai da ilha, passeia pela tela e te avisa das coisas." style={{ top: 150 }} />
      <div className="mo-dock">
        {["#5b9dff", "#4fd67b", "#ff6f8e", "#ffb03a", "#b28dff", "#5cc9f5", "#a3a3ab"].map((color, index) => (
          <span key={index} style={{ background: `linear-gradient(180deg, ${color}, ${color}cc)` }}>
            <AppWindow size={26} strokeWidth={2} />
          </span>
        ))}
      </div>
      <div className="mo-walker" style={{ transform: `translate(${x}px, ${-bob}px) rotate(${stepping ? Math.sin(s.local * 9) * 5 : 0}deg)` }}>
        <Mascot mood={s.local > 2.6 ? "greeting" : "idle"} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={130} showDot={false} forceMotion />
      </div>
      <div className="mo-bubble" style={{ left: x - 80, opacity: clamp(bubble), transform: `scale(${0.6 + bubble * 0.4})` }}>
        <span>{typed.slice(0, chars)}</span>
        <b>Abrir</b>
      </div>
    </section>
  );
}

function Outro({ time }: { time: number }) {
  const s = sceneWindow(time, SCENES.outro, 0.5);
  if (!s.visible) return null;
  const pop = outBack(ramp(s.local, 0.2, 0.8));
  const line = (start: number) => {
    const p = outCubic(ramp(s.local, start, 0.6));
    return { opacity: p, transform: `translateY(${(1 - p) * 18}px)` };
  };
  const fade = 1 - ramp(time, DURATION - 0.9, 0.9);
  return (
    <section className="mo-scene mo-outro" style={{ opacity: s.opacity * fade }}>
      <div className="mo-glow" />
      <div style={{ transform: `scale(${pop})`, opacity: clamp(pop) }}>
        <Mascot mood="greeting" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={170} showDot={false} forceMotion glow />
      </div>
      <h1 style={line(0.6)}>Nimbo</h1>
      <p className="mo-outro__lead" style={line(1.0)}>Grátis e de código aberto.</p>
      <p className="mo-outro__link" style={line(1.5)}>github.com/EduardoxDev/Nimbo</p>
      <div className="mo-chips" style={line(2.0)}>
        {["Tauri 2", "Rust", "React 19", "TypeScript"].map((chip) => (
          <span key={chip}>{chip}</span>
        ))}
      </div>
      <p className="mo-outro__soon" style={line(2.7)}>Na v1.0: “Alexa, pede pro Nimbo começar um foco.”</p>
    </section>
  );
}

function seedAutomations() {
  const now = Date.now();
  const rules = [
    { id: "a", text: "x", enabled: true, name: "Foco silencioso", trigger: { kind: "focusStart" }, action: { kind: "pause" }, actions: [{ kind: "pause" }, { kind: "volume", level: 15 }] },
    { id: "b", text: "x", enabled: true, name: "Bom dia", trigger: { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5] }, action: { kind: "routine", routine: "start" } },
    { id: "d", text: "x", enabled: true, trigger: { kind: "claudeDone" }, action: { kind: "say", text: "O Claude terminou. Vem ver!" } },
    { id: "e", text: "x", enabled: true, name: "Fone conectado", trigger: { kind: "headphones" }, action: { kind: "music", query: "Lo-fi para focar" } },
    { id: "c", text: "x", enabled: false, name: "Saí do PC", trigger: { kind: "idle", minutes: 15 }, action: { kind: "pause" }, actions: [{ kind: "pause" }, { kind: "lock" }] },
  ];
  const log = [
    { id: "1", ruleId: "a", name: "Foco silencioso", at: now - 12 * 60_000, ok: true },
    { id: "2", ruleId: "b", name: "Bom dia", at: now - 3 * 3_600_000, ok: true },
    { id: "3", ruleId: "d", name: "O Claude terminou", at: now - 5 * 3_600_000, ok: true },
  ];
  window.localStorage.setItem("nimbo-rules", JSON.stringify(rules));
  window.localStorage.setItem("nimbo-rules-log", JSON.stringify(log));
}

function Motion() {
  const time = useClock();
  return (
    <div className="mo-stage">
      <Intro time={time} />
      <Island time={time} />
      <Pages time={time} />
      <Music time={time} />
      <Automations time={time} />
      <More time={time} />
      <Buddy time={time} />
      <Outro time={time} />
    </div>
  );
}

seedAutomations();
window.__motionStart = () => {
  window.__t0 = performance.now();
};
if (!new URLSearchParams(window.location.search).has("record")) window.__motionStart();

ReactDOM.createRoot(document.getElementById("motion") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <Motion />
    </I18nProvider>
  </React.StrictMode>,
);
