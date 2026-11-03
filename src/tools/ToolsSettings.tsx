import { useEffect, useState } from "react";
import { Brain, Trash2 } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { IslandSettings } from "../App";
import { Row, Section, Stepper, Toggle } from "../settings/controls";
import { AMBIENT_KINDS, type AmbientKind } from "./ambient";
import {
  cleanTrigger,
  COMMON_ZONES,
  FRIENDS_KEY,
  hourIn,
  loadFriends,
  loadSnippets,
  momentOf,
  PALETTE_KEY,
  SNIPPETS_KEY,
  type FriendClock,
  type Snippet,
} from "./tools";

function useStored<T>(key: string, parse: (raw: string | null) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Kept for this window only.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

function parsePalette(raw: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" && /^#[0-9a-f]{6}$/i.test(item)) : [];
  } catch {
    return [];
  }
}

const SUGGESTED: Snippet[] = [
  { trigger: ";data", text: "{data}" },
  { trigger: ";obg", text: "Muito obrigado pelo retorno! Qualquer coisa, estou à disposição." },
];

/** Settings → Tools: text expander, friends' clocks and the smaller helpers. */
export function ToolsSettings({ settings, update }: { settings: IslandSettings; update: (patch: Partial<IslandSettings>) => void }) {
  const t = useTranslation();
  const copy = t.tools;
  const [snippets, setSnippets] = useStored<Snippet[]>(SNIPPETS_KEY, (raw) => (raw === null ? SUGGESTED : loadSnippets(raw)));
  const [friends, setFriends] = useStored<FriendClock[]>(FRIENDS_KEY, loadFriends);
  const [palette] = useStored<string[]>(PALETTE_KEY, parsePalette);
  const [trigger, setTrigger] = useState("");
  const [text, setText] = useState("");
  const [friendName, setFriendName] = useState("");
  const [zone, setZone] = useState(COMMON_ZONES[7]);
  const [copied, setCopied] = useState<string | null>(null);
  const now = new Date();

  const addSnippet = () => {
    const clean = cleanTrigger(trigger);
    if (!clean || !text.trim()) return;
    setSnippets((current) => [...current.filter((item) => item.trigger !== clean), { trigger: clean, text: text.trim() }].slice(0, 100));
    setTrigger("");
    setText("");
  };

  return (
    <>
      <Section title={t.memory.openWindow}>
        <Row title={t.memory.openWindow} hint={t.memory.openWindowHint}>
          <button type="button" className="prefs-button" onClick={() => isTauri() && void invoke("memory_open").catch(() => {})}>
            <Brain size={14} strokeWidth={2.4} />
            {t.memory.openWindow}
          </button>
        </Row>
      </Section>
      <Section title={copy.snippetsTitle}>
        <p className="prefs-auto__hint">{copy.snippetsHint}</p>
        {snippets.map((snippet) => (
          <Row key={snippet.trigger} title={snippet.trigger} hint={snippet.text.length > 90 ? `${snippet.text.slice(0, 88)}…` : snippet.text}>
            <button className="prefs-button prefs-button--quiet" type="button" aria-label={`${copy.remove} ${snippet.trigger}`} onClick={() => setSnippets((current) => current.filter((item) => item !== snippet))}>
              <Trash2 size={14} strokeWidth={2.2} />
            </button>
          </Row>
        ))}
        <div className="prefs-auto__new prefs-tools__snippet">
          <input value={trigger} placeholder={copy.triggerPlaceholder} aria-label={copy.triggerPlaceholder} spellCheck={false} onChange={(event) => setTrigger(event.currentTarget.value)} />
          <textarea value={text} placeholder={copy.textPlaceholder} aria-label={copy.textPlaceholder} rows={2} onChange={(event) => setText(event.currentTarget.value)} />
          <button className="prefs-button" type="button" disabled={!cleanTrigger(trigger) || !text.trim()} onClick={addSnippet}>
            {copy.add}
          </button>
        </div>
      </Section>

      <Section title={copy.smartTitle}>
        <Row title={copy.convertTitle} hint={copy.convertHint}>
          <Toggle label={copy.convertTitle} checked={settings.toolConvert} onChange={(toolConvert) => update({ toolConvert })} />
        </Row>
        <Row title={copy.scamTitle} hint={copy.scamHint}>
          <Toggle label={copy.scamTitle} checked={settings.toolScam} onChange={(toolScam) => update({ toolScam })} />
        </Row>
        <Row title={copy.printsTitle} hint={copy.printsHint}>
          <Toggle label={copy.printsTitle} checked={settings.toolPrints} onChange={(toolPrints) => update({ toolPrints })} />
        </Row>
        <Row title={copy.gameTitle} hint={copy.gameHint}>
          <Toggle label={copy.gameTitle} checked={settings.breakGame} onChange={(breakGame) => update({ breakGame })} />
        </Row>
        <Row title={copy.ambientFocusTitle} hint={copy.ambientFocusHint}>
          <select
            className="prefs-tools__select"
            value={settings.ambientWithFocus}
            aria-label={copy.ambientFocusTitle}
            onChange={(event) => update({ ambientWithFocus: event.currentTarget.value as AmbientKind | "off" })}
          >
            <option value="off">{copy.off}</option>
            {AMBIENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t.ambient.kinds[kind]}
              </option>
            ))}
          </select>
        </Row>
        <Row title={copy.readTitle} hint={copy.readHint}>
          <Stepper
            value={settings.readRate}
            min={0.6}
            max={2}
            step={0.1}
            format={(value) => `${value.toFixed(1)}×`}
            decreaseLabel={`${t.prefs.appearance.decrease} ${copy.readTitle}`}
            increaseLabel={`${t.prefs.appearance.increase} ${copy.readTitle}`}
            onChange={(readRate) => update({ readRate: Math.round(readRate * 10) / 10 })}
          />
        </Row>
      </Section>

      <Section title={copy.friendsTitle}>
        <p className="prefs-auto__hint">{copy.friendsHint}</p>
        {friends.map((friend) => {
          const at = hourIn(friend.zone, now);
          return (
            <Row
              key={`${friend.name}-${friend.zone}`}
              title={friend.name}
              hint={at ? `${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")} · ${copy.moments[momentOf(at.hour)]} · ${friend.zone.split("/").pop()?.replace(/_/g, " ")}` : friend.zone}
            >
              <button className="prefs-button prefs-button--quiet" type="button" aria-label={`${copy.remove} ${friend.name}`} onClick={() => setFriends((current) => current.filter((item) => item !== friend))}>
                <Trash2 size={14} strokeWidth={2.2} />
              </button>
            </Row>
          );
        })}
        <div className="prefs-auto__new">
          <input value={friendName} placeholder={copy.friendName} aria-label={copy.friendName} maxLength={24} onChange={(event) => setFriendName(event.currentTarget.value)} />
          <select value={zone} aria-label={copy.friendsTitle} onChange={(event) => setZone(event.currentTarget.value)}>
            {COMMON_ZONES.map((item) => (
              <option key={item} value={item}>
                {item.split("/").pop()?.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            className="prefs-button"
            type="button"
            disabled={!friendName.trim() || friends.length >= 8}
            onClick={() => {
              setFriends((current) => [...current, { name: friendName.trim(), zone }]);
              setFriendName("");
            }}
          >
            {copy.add}
          </button>
        </div>
      </Section>

      <Section title={copy.paletteTitle}>
        {palette.length === 0 ? (
          <p className="prefs-auto__hint">{copy.paletteEmpty}</p>
        ) : (
          <div className="prefs-tools__palette">
            {palette.map((hex) => (
              <button
                key={hex}
                type="button"
                className="prefs-tools__swatch"
                style={{ background: hex }}
                title={hex}
                aria-label={hex}
                onClick={() => void navigator.clipboard.writeText(hex).then(() => setCopied(hex)).catch(() => {})}
              >
                <span>{copied === hex ? copy.copied : hex}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
