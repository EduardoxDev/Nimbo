import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { Row, Section } from "./controls";
import {
  SHORTCUT_ACTIONS,
  shortcutFromEvent,
  shortcutRequests,
  type ShortcutAction,
  type ShortcutResult,
  type Shortcuts,
} from "./shortcut";

export function ShortcutsSettings({
  shortcuts,
  onChange,
}: {
  shortcuts: Shortcuts;
  onChange: (shortcuts: Shortcuts) => void;
}) {
  const copy = useTranslation().shortcuts;
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ShortcutAction, string>>>({});

  const save = (next: Shortcuts) => {
    onChange(next);
    if (!isTauri()) return;
    void invoke<ShortcutResult[]>("set_global_shortcuts", { shortcuts: shortcutRequests(next) })
      .then((results) =>
        setErrors(Object.fromEntries(results.filter((result) => result.error).map((result) => [result.action, result.error ?? ""]))),
      )
      .catch((failure) => console.error("Failed to register shortcuts", failure));
  };

  return (
    <Section title={copy.section}>
      {SHORTCUT_ACTIONS.map((action) => (
        <Row key={action} title={copy.actions[action]} hint={errors[action]}>
          <span className="prefs-shortcut">
            <input
              className="prefs-shortcut__input"
              readOnly
              aria-label={copy.actions[action]}
              value={recording === action ? copy.press : shortcuts[action] || copy.none}
              onFocus={() => setRecording(action)}
              onBlur={() => setRecording(null)}
              onKeyDown={(event) => {
                if (event.key === "Tab") return;
                event.preventDefault();
                if (event.key === "Escape") {
                  event.currentTarget.blur();
                  return;
                }
                if (event.key === "Backspace" || event.key === "Delete") {
                  save({ ...shortcuts, [action]: "" });
                  event.currentTarget.blur();
                  return;
                }
                const shortcut = shortcutFromEvent(event);
                if (!shortcut) return;
                save({ ...shortcuts, [action]: shortcut });
                event.currentTarget.blur();
              }}
            />
            {shortcuts[action] && (
              <button
                className="prefs-button prefs-button--quiet"
                type="button"
                onClick={() => save({ ...shortcuts, [action]: "" })}
              >
                {copy.clear}
              </button>
            )}
          </span>
        </Row>
      ))}
      <p className="prefs-card__hint prefs-card__hint--bottom">{copy.hint}</p>
    </Section>
  );
}
