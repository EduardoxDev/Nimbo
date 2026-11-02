import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Copy, RefreshCw } from "lucide-react";
import { useTranslation } from "../i18n";
import { Row, Section, Toggle } from "../settings/controls";
import type { IslandSettings } from "../App";
import { RelaySettings } from "./RelaySettings";
import { AlexaSettings } from "./AlexaSettings";

type PhoneInfo = { running: boolean; url: string | null; qrSvg: string | null };

/** Settings page: the island on the phone and the phone's notifications on the island. */
export function PhoneSettings({ settings, update }: { settings: IslandSettings; update: (patch: Partial<IslandSettings>) => void }) {
  const copy = useTranslation().phone;
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    // The island window starts and stops the server; this page only shows it.
    const load = () => void invoke<PhoneInfo>("phone_info").then(setInfo).catch(() => {});
    load();
    const interval = window.setInterval(load, 2_000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleNotifications = (enabled: boolean) => {
    setNotice("");
    if (!enabled) {
      update({ phoneNotifications: false });
      return;
    }
    void invoke<string>("notifications_start", { onlyPhone: !settings.allNotifications })
      .then((status) => {
        if (status === "allowed") update({ phoneNotifications: true });
        else setNotice(copy.notificationsDenied);
      })
      .catch((error) => setNotice(String(error)));
  };

  return (
    <>
      <Section title={copy.islandTitle}>
        <Row title={copy.islandToggle} hint={copy.islandHint}>
          <Toggle label={copy.islandToggle} checked={settings.phoneIsland} onChange={(phoneIsland) => update({ phoneIsland })} />
        </Row>
        {settings.phoneIsland && info?.running && info.url && (
          <div className="prefs-phone">
            {info.qrSvg && <img className="prefs-phone__qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`} alt={copy.scan} />}
            <div className="prefs-phone__side">
              <strong>{copy.scan}</strong>
              <span>{copy.sameWifi}</span>
              <code>{info.url}</code>
              <div className="prefs-phone__actions">
                <button
                  type="button"
                  className="prefs-button prefs-button--quiet"
                  onClick={() =>
                    void invoke("copy_translation_result", { text: info.url }).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1400);
                    })
                  }
                >
                  <Copy size={13} strokeWidth={2.4} /> {copied ? copy.copied : copy.copyLink}
                </button>
                <button type="button" className="prefs-button prefs-button--quiet" onClick={() => void invoke<PhoneInfo>("phone_new_code").then(setInfo)}>
                  <RefreshCw size={13} strokeWidth={2.4} /> {copy.newCode}
                </button>
              </div>
              <small>{copy.firewall}</small>
            </div>
          </div>
        )}
        {settings.phoneIsland && info && !info.running && <p className="prefs-auto__hint">{copy.starting}</p>}
      </Section>

      <RelaySettings />

      <AlexaSettings settings={settings} update={update} />

      <Section title={copy.shareTitle}>
        <Row title={copy.shareClipboard} hint={copy.shareClipboardHint}>
          <Toggle label={copy.shareClipboard} checked={settings.phoneShareClipboard} onChange={(phoneShareClipboard) => update({ phoneShareClipboard })} />
        </Row>
        <Row title={copy.shareActivity} hint={copy.shareActivityHint}>
          <Toggle label={copy.shareActivity} checked={settings.phoneShareActivity} onChange={(phoneShareActivity) => update({ phoneShareActivity })} />
        </Row>
      </Section>

      <Section title={copy.notificationsTitle}>
        <Row title={copy.notificationsToggle} hint={copy.notificationsHint}>
          <Toggle label={copy.notificationsToggle} checked={settings.phoneNotifications} onChange={toggleNotifications} />
        </Row>
        <Row title={copy.allApps} hint={copy.allAppsHint}>
          <Toggle label={copy.allApps} checked={settings.allNotifications} onChange={(allNotifications) => update({ allNotifications })} />
        </Row>
        {notice && <p className="prefs-auto__hint">{notice}</p>}
      </Section>
    </>
  );
}
