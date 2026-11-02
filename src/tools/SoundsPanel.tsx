import { useEffect, useState } from "react";
import { AudioLines, CloudRain, Coffee, Flame, Waves, type LucideIcon } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { AMBIENT_KEY, AMBIENT_KINDS, playingAmbient, setAmbientVolume, startAmbient, stopAmbient, type AmbientKind } from "./ambient";
import "./Tools.css";

const LOOK: Record<AmbientKind, { icon: LucideIcon; color: string }> = {
  rain: { icon: CloudRain, color: "#5ac8fa" },
  cafe: { icon: Coffee, color: "#c69c6d" },
  fire: { icon: Flame, color: "#ff9f0a" },
  waves: { icon: Waves, color: "#40c8e0" },
  brown: { icon: AudioLines, color: "#bf8cff" },
};

export function loadAmbientVolumes(): Record<AmbientKind, number> {
  const fallback = Object.fromEntries(AMBIENT_KINDS.map((kind) => [kind, 0.5])) as Record<AmbientKind, number>;
  try {
    const value = JSON.parse(window.localStorage.getItem(AMBIENT_KEY) ?? "{}");
    for (const kind of AMBIENT_KINDS) if (typeof value?.[kind] === "number") fallback[kind] = Math.min(1, Math.max(0, value[kind]));
  } catch {
    // Default volumes.
  }
  return fallback;
}

/** Ambient sounds: tap to play (two at a time), slide to set each one's volume. */
export function SoundsPanel<Page extends string>({
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const copy = useTranslation().ambient;
  const [playing, setPlaying] = useState<AmbientKind[]>(playingAmbient);
  const [volumes, setVolumes] = useState(loadAmbientVolumes);

  useEffect(() => {
    try {
      window.localStorage.setItem(AMBIENT_KEY, JSON.stringify(volumes));
    } catch {
      // Volumes reset next time.
    }
  }, [volumes]);

  const toggle = (kind: AmbientKind) => {
    if (playingAmbient().includes(kind)) stopAmbient(kind);
    else startAmbient(kind, volumes[kind]);
    setPlaying(playingAmbient());
  };

  return (
    <PageChrome icon={AudioLines} iconColor="#bf8cff" pages={pages} currentPage={currentPage} showPageIcons={showPageIcons} onPageChange={onPageChange} className="sounds-panel" label={copy.title}>
      <div className="sounds-panel__grid">
        {AMBIENT_KINDS.map((kind) => {
          const { icon: Icon, color } = LOOK[kind];
          const on = playing.includes(kind);
          return (
            <div key={kind} className={`sounds-tile${on ? " sounds-tile--on" : ""}`} style={{ "--sound": color } as React.CSSProperties}>
              <button type="button" className="sounds-tile__button n-pressable" aria-pressed={on} onClick={() => toggle(kind)}>
                <Icon size={20} strokeWidth={2.2} />
                <span>{copy.kinds[kind]}</span>
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volumes[kind]}
                aria-label={`${copy.volume} · ${copy.kinds[kind]}`}
                data-window-drag="false"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setVolumes((current) => ({ ...current, [kind]: value }));
                  setAmbientVolume(kind, value);
                }}
              />
            </div>
          );
        })}
      </div>
      <p className="sounds-panel__hint">{copy.hint}</p>
    </PageChrome>
  );
}
