import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useLocale, useTranslation } from "../i18n";
import { Row, Section } from "../settings/controls";
import type { WeatherPlace } from "./weather";

export function WeatherSettings({
  place,
  onChange,
}: {
  place: WeatherPlace | null;
  onChange: (place: WeatherPlace | null) => void;
}) {
  const copy = useTranslation().weather;
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const text = query.trim();
    if (!isTauri() || text.length < 2) {
      setResults([]);
      return;
    }
    const language = locale === "zh-CN" ? "zh" : locale === "en" ? "en" : "pt";
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError("");
      void invoke<WeatherPlace[]>("weather_search", { query: text, language })
        .then(setResults)
        .catch((failure) => setError(String(failure)))
        .finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, locale]);

  return (
    <Section title={copy.section}>
      {place ? (
        <Row title={place.name} hint={place.region}>
          <button className="prefs-button prefs-button--quiet" type="button" onClick={() => onChange(null)}>
            {copy.remove}
          </button>
        </Row>
      ) : (
        <div className="prefs-form">
          <label className="prefs-field">
            <span>{copy.city}</span>
            <input
              type="search"
              value={query}
              placeholder={copy.cityPlaceholder}
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <small>{searching ? copy.searching : query.trim().length >= 2 && results.length === 0 ? copy.noResults : copy.hint}</small>
          </label>
          {results.map((result) => (
            <Row key={`${result.latitude},${result.longitude}`} title={result.name} hint={result.region}>
              <button
                className="prefs-button"
                type="button"
                onClick={() => {
                  onChange(result);
                  setQuery("");
                  setResults([]);
                }}
              >
                {copy.choose}
              </button>
            </Row>
          ))}
        </div>
      )}
      <p className="prefs-card__hint prefs-card__hint--bottom">{copy.attribution}</p>
      {error && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}
