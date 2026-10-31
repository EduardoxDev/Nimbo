import type { IslandSettings } from "../App";
import { useTranslation } from "../i18n";
import { Row, Section, Segmented } from "../settings/controls";

export function ClaudeTaskSettings({
  settings,
  update,
}: {
  settings: IslandSettings;
  update: (patch: Partial<IslandSettings>) => void;
}) {
  const copy = useTranslation().prefs.claudeTask;
  return (
    <Section title={copy.section}>
      <div className="prefs-form">
        <label className="prefs-field">
          <span>{copy.folder}</span>
          <input
            type="text"
            value={settings.claudeFolder}
            placeholder={copy.folderPlaceholder}
            spellCheck={false}
            onChange={(event) => update({ claudeFolder: event.currentTarget.value })}
          />
          <small>{copy.folderHint}</small>
        </label>
      </div>
      <Row title={copy.mode} hint={settings.claudeMode === "plan" ? copy.planHint : copy.editHint}>
        <Segmented
          label={copy.mode}
          value={settings.claudeMode}
          options={[
            { value: "acceptEdits", label: copy.edit },
            { value: "plan", label: copy.plan },
          ]}
          onChange={(claudeMode) => update({ claudeMode })}
        />
      </Row>
    </Section>
  );
}
