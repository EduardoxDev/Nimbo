import { useState } from "react";
import type { IslandSettings } from "../App";
import { useTranslation } from "../i18n";
import { Section } from "./controls";
import { THEME_PRESETS, exportTheme, parseTheme } from "./themes";

export function ThemesSettings({
  settings,
  update,
}: {
  settings: IslandSettings;
  update: (patch: Partial<IslandSettings>) => void;
}) {
  const copy = useTranslation().themes;
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState("");

  const copyTheme = async () => {
    try {
      await navigator.clipboard.writeText(
        exportTheme({
          appearanceMode: settings.appearanceMode,
          islandBackgroundColor: settings.islandBackgroundColor,
          pulseColor: settings.pulseColor,
          taskTextColor: settings.taskTextColor,
          glassTint: settings.glassTint,
          glassIntensity: settings.glassIntensity,
          opacity: settings.opacity,
        }),
      );
      setMessage(copy.copied);
    } catch {
      setMessage(copy.copyFailed);
    }
  };

  const applyImport = () => {
    const theme = parseTheme(importText);
    if (!theme) {
      setMessage(copy.invalid);
      return;
    }
    update(theme);
    setImportText("");
    setMessage(copy.applied);
  };

  return (
    <Section title={copy.section}>
      <div className="prefs-themes" role="radiogroup" aria-label={copy.section}>
        {THEME_PRESETS.map((preset) => {
          const active =
            settings.islandBackgroundColor.toLowerCase() === preset.background.toLowerCase() &&
            settings.pulseColor.toLowerCase() === preset.accent.toLowerCase();
          return (
            <button
              key={preset.id}
              className={`prefs-theme${active ? " prefs-theme--active" : ""}`}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => update({ islandBackgroundColor: preset.background, pulseColor: preset.accent })}
            >
              <span className="prefs-theme__swatch" style={{ background: preset.background }} aria-hidden="true">
                <span style={{ background: preset.accent }} />
              </span>
              <span>{copy.presets[preset.id as keyof typeof copy.presets]}</span>
            </button>
          );
        })}
      </div>
      <div className="prefs-form">
        <label className="prefs-field">
          <span>{copy.importLabel}</span>
          <textarea
            className="prefs-theme-import"
            value={importText}
            rows={2}
            spellCheck={false}
            placeholder={copy.importPlaceholder}
            onChange={(event) => setImportText(event.currentTarget.value)}
          />
        </label>
        <div className="prefs-form__actions">
          <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void copyTheme()}>
            {copy.copy}
          </button>
          <button className="prefs-button" type="button" disabled={!importText.trim()} onClick={applyImport}>
            {copy.apply}
          </button>
        </div>
        {message && (
          <p className="prefs-card__hint" role="status">
            {message}
          </p>
        )}
      </div>
    </Section>
  );
}
