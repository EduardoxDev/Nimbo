import { useSyncExternalStore } from "react";
import { getWeather, subscribeWeather, weatherKind } from "../weather/weather";
import "./IslandFx.css";

const DROPS = Array.from({ length: 14 }, (_, index) => ({ left: (index * 37) % 100, delay: (index * 0.23) % 1.4 }));
const STARS = Array.from({ length: 9 }, (_, index) => ({ left: (index * 29 + 7) % 100, top: (index * 41 + 13) % 80, delay: (index * 0.7) % 3 }));

export function IslandWeather() {
  const weather = useSyncExternalStore(subscribeWeather, getWeather, getWeather);
  if (!weather) return null;
  const kind = weatherKind(weather.code);
  const scene =
    kind === "rain" || kind === "drizzle" || kind === "storm"
      ? "rain"
      : kind === "snow"
      ? "snow"
      : kind === "fog"
      ? "fog"
      : (kind === "clear" || kind === "partly") && !weather.isDay
      ? "stars"
      : kind === "clear" && weather.isDay
      ? "sun"
      : null;
  if (!scene) return null;
  return (
    <div className={`island-weather island-weather--${scene}${kind === "storm" ? " island-weather--storm" : ""}`} aria-hidden="true">
      {(scene === "rain" || scene === "snow") &&
        DROPS.map((drop, index) => <i key={index} style={{ left: `${drop.left}%`, animationDelay: `${drop.delay}s` }} />)}
      {scene === "stars" &&
        STARS.map((star, index) => <i key={index} style={{ left: `${star.left}%`, top: `${star.top}%`, animationDelay: `${star.delay}s` }} />)}
    </div>
  );
}
