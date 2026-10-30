import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AirVent, Check, Fan, Lightbulb, Lock, Plug } from "lucide-react";
import { useTranslation } from "../i18n";
import { Row, Section } from "../settings/controls";
import { InfraredSettings } from "./InfraredSettings";
import {
  homeApi,
  loadHomeFavorites,
  saveHomeFavorites,
  visibleHomeEntities,
  type HomeEntity,
  type HomeStatus,
} from "./homeStore";

const DOMAIN_ICONS = {
  climate: AirVent,
  light: Lightbulb,
  switch: Plug,
  fan: Fan,
};

/** "Home" page of the settings window: connect Home Assistant and pick devices. */
export function HomeSettingsPage() {
  const t = useTranslation();
  const copy = t.prefs.home;
  const [status, setStatus] = useState<HomeStatus | null>(null);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<HomeEntity[]>([]);
  const [favorites, setFavorites] = useState<string[] | null>(loadHomeFavorites);

  const loadEntities = useCallback(async () => {
    try {
      setEntities(await homeApi.entities());
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  useEffect(() => {
    homeApi
      .status()
      .then((next) => {
        setStatus(next);
        if (next.url) setUrl(next.url);
        if (next.configured) void loadEntities();
      })
      .catch((reason) => setError(String(reason)));
  }, [loadEntities]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setIsConnecting(true);
    setError(null);
    try {
      const next = await homeApi.connect(url, token);
      setStatus(next);
      setToken("");
      await loadEntities();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await homeApi.disconnect();
      setStatus({ configured: false, url: status?.url ?? null });
      setEntities([]);
    } catch (reason) {
      setError(String(reason));
    }
  };

  // The first tick turns the defaults into an explicit list, then edits it.
  const shown = new Set(visibleHomeEntities(entities, favorites).map((entity) => entity.entityId));
  const toggleFavorite = (entityId: string) => {
    const next = new Set(shown);
    if (next.has(entityId)) next.delete(entityId);
    else next.add(entityId);
    const ordered = entities.map((entity) => entity.entityId).filter((id) => next.has(id));
    setFavorites(ordered);
    saveHomeFavorites(ordered);
  };

  return (
    <>
      <InfraredSettings />

      <Section title={copy.section}>
        {status?.configured ? (
          <Row title={copy.connected} hint={status.url ?? undefined}>
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void disconnect()}>
              {copy.disconnect}
            </button>
          </Row>
        ) : (
          <form className="prefs-form" onSubmit={(event) => void connect(event)}>
            <label className="prefs-field">
              <span>{copy.address}</span>
              <input
                type="url"
                value={url}
                placeholder={copy.addressPlaceholder}
                autoComplete="url"
                spellCheck={false}
                required
                onChange={(event) => setUrl(event.currentTarget.value)}
              />
            </label>
            <label className="prefs-field">
              <span>{copy.token}</span>
              <input
                type="password"
                value={token}
                placeholder={copy.tokenPlaceholder}
                autoComplete="off"
                spellCheck={false}
                required
                onChange={(event) => setToken(event.currentTarget.value)}
              />
              <small>{copy.tokenHint}</small>
            </label>
            <div className="prefs-form__actions">
              <button className="prefs-button" type="submit" disabled={isConnecting || !url || !token}>
                {isConnecting ? copy.connecting : copy.connect}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="prefs-error" role="alert">
            {error}
          </p>
        )}
      </Section>

      {status?.configured && (
        <Section title={copy.devices}>
          <p className="prefs-card__hint">{copy.devicesHint}</p>
          {entities.length === 0 ? (
            <Row title={copy.noDevices} />
          ) : (
            <ul className="prefs-devices">
              {entities.map((entity) => {
                const Icon = DOMAIN_ICONS[entity.domain];
                const isShown = shown.has(entity.entityId);
                return (
                  <li key={entity.entityId}>
                    <button
                      className={`prefs-device${isShown ? " prefs-device--on" : ""}`}
                      type="button"
                      role="checkbox"
                      aria-checked={isShown}
                      onClick={() => toggleFavorite(entity.entityId)}
                    >
                      <span className={`prefs-device__icon prefs-device__icon--${entity.domain}`} aria-hidden="true">
                        <Icon size={15} strokeWidth={2.3} />
                      </span>
                      <span className="prefs-device__text">
                        <strong>{entity.name}</strong>
                        <span>{copy.domains[entity.domain]}</span>
                      </span>
                      <span className="prefs-device__check" aria-hidden="true">
                        {isShown && <Check size={12} strokeWidth={3.2} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <p className="prefs-note">
        <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
        {copy.privacy}
      </p>
    </>
  );
}
