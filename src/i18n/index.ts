import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LocaleCode, Translations } from "./types";
import zhCN from "./locales/zh-CN.ts";
import en from "./locales/en.ts";
import ptBR from "./locales/pt-BR.ts";

export type { LocaleCode, Translations };

export const LOCALE_STORAGE_KEY = "nimbo-locale";

export const TRANSLATIONS: Record<LocaleCode, Translations> = {
  "pt-BR": ptBR,
  en,
  "zh-CN": zhCN,
};

export const LOCALE_CODES = Object.keys(TRANSLATIONS) as LocaleCode[];

/** Nimbo is Brazilian-first, so an unrecognized system locale falls back to pt-BR. */
export const FALLBACK_LOCALE: LocaleCode = "pt-BR";

export function isLocaleCode(value: unknown): value is LocaleCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TRANSLATIONS, value)
  );
}

export function detectLocale(languages: readonly string[]): LocaleCode {
  for (const candidate of languages) {
    const normalized = candidate.toLowerCase();
    const supported = LOCALE_CODES.find((code) => code.toLowerCase() === normalized);
    if (supported) return supported;

    const base = normalized.split("-")[0];

    if (base === "zh") {
      return "zh-CN";
    }

    if (base === "pt") {
      return "pt-BR";
    }

    if (isLocaleCode(base)) {
      return base;
    }
  }

  return FALLBACK_LOCALE;
}

export function loadLocale(): LocaleCode {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocaleCode(stored)) return stored;
  } catch {
    // A blocked storage area must not prevent the interface from opening.
  }
  return detectLocale([...(navigator.languages ?? []), navigator.language]);
}

export function saveLocale(locale: LocaleCode) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The current session can still switch languages when storage is unavailable.
  }
}

const TranslationContext = createContext<Translations>(TRANSLATIONS[FALLBACK_LOCALE]);
const LocaleContext = createContext<{ locale: LocaleCode; setLocale: (locale: LocaleCode) => void }>({
  locale: FALLBACK_LOCALE,
  setLocale: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<LocaleCode>(loadLocale);
  const setLocale = useCallback((next: LocaleCode) => {
    if (!isLocaleCode(next)) return;
    updateLocale(next);
    saveLocale(next);
  }, []);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const syncLocale = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY || event.key === null) updateLocale(loadLocale());
    };
    window.addEventListener("storage", syncLocale);
    return () => window.removeEventListener("storage", syncLocale);
  }, []);

  return createElement(LocaleContext.Provider, { value },
    createElement(TranslationContext.Provider, { value: TRANSLATIONS[locale] }, children));
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useTranslation() {
  return useContext(TranslationContext);
}
