import { useSyncExternalStore } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun } from "lucide-react";
import { useTranslation } from "../i18n";
import { getWeather, subscribeWeather, weatherKind } from "./weather";

export function WeatherChip() {
  const t = useTranslation();
  const weather = useSyncExternalStore(subscribeWeather, getWeather, getWeather);
  if (!weather) return null;
  const kind = weatherKind(weather.code);
  const Icon =
    kind === "clear"
      ? weather.isDay ? Sun : Moon
      : kind === "partly"
        ? weather.isDay ? CloudSun : CloudMoon
        : kind === "fog"
          ? CloudFog
          : kind === "drizzle"
            ? CloudDrizzle
            : kind === "rain"
              ? CloudRain
              : kind === "snow"
                ? CloudSnow
                : kind === "storm"
                  ? CloudLightning
                  : Cloud;
  const range =
    weather.max !== null && weather.min !== null
      ? ` · ${t.weather.range(Math.round(weather.max), Math.round(weather.min))}`
      : "";

  return (
    <span className="weather-chip" title={`${t.weather.kinds[kind]}${range}`}>
      <Icon size={14} strokeWidth={2.4} aria-hidden="true" />
      <span>{Math.round(weather.temperature)}°</span>
    </span>
  );
}
