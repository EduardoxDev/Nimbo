import { useState } from "react";
import { useTranslation } from "../i18n";
import { Row, Section } from "../settings/controls";
import { loadSquad, newMemberId, newSquadCode, normalizeSquadCode, prettyCode, SQUAD_KEY, type SquadConfig } from "./squad";

function save(config: SquadConfig | null) {
  try {
    if (config) window.localStorage.setItem(SQUAD_KEY, JSON.stringify(config));
    else window.localStorage.removeItem(SQUAD_KEY);
  } catch {
    // The island keeps the group it had.
  }
}

/** Settings → Pomodoro: create or join a "focus together" group. */
export function SquadSettings() {
  const copy = useTranslation().squad;
  const [config, setConfig] = useState<SquadConfig | null>(() => loadSquad());
  const [name, setName] = useState(config?.name ?? "");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (next: SquadConfig | null) => {
    save(next);
    setConfig(next);
    setNotice(null);
  };
  const join = (groupCode: string) => apply({ code: groupCode, name: name.trim().slice(0, 24), id: config?.id ?? newMemberId() });

  return (
    <Section title={copy.title}>
      <p className="prefs-auto__hint">{copy.hint}</p>
      <Row title={copy.yourName}>
        <div className="prefs-auto__new">
          <input
            value={name}
            maxLength={24}
            placeholder={copy.namePlaceholder}
            aria-label={copy.yourName}
            onChange={(event) => setName(event.currentTarget.value)}
            onBlur={() => config && apply({ ...config, name: name.trim().slice(0, 24) })}
          />
        </div>
      </Row>
      {config ? (
        <>
          <Row title={copy.codeLabel} hint={copy.codeHint}>
            <strong className="prefs-squad__code">{prettyCode(config.code)}</strong>
            <button
              className="prefs-button"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(prettyCode(config.code))
                  .then(() => setNotice(copy.copied))
                  .catch(() => {})
              }
            >
              {copy.copy}
            </button>
          </Row>
          <div className="prefs-auto__new">
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => apply(null)}>
              {copy.leave}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="prefs-auto__new">
            <button className="prefs-button" type="button" disabled={!name.trim()} onClick={() => join(newSquadCode())}>
              {copy.create}
            </button>
          </div>
          <div className="prefs-auto__new">
            <input
              value={code}
              placeholder={copy.codePlaceholder}
              aria-label={copy.codePlaceholder}
              spellCheck={false}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
            <button
              className="prefs-button"
              type="button"
              disabled={!name.trim() || !code.trim()}
              onClick={() => {
                const groupCode = normalizeSquadCode(code);
                if (groupCode) join(groupCode);
                else setNotice(copy.invalid);
              }}
            >
              {copy.join}
            </button>
          </div>
        </>
      )}
      {notice && <p className="prefs-auto__hint">{notice}</p>}
    </Section>
  );
}
