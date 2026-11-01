import { useEffect, useState } from "react";
import { Disc3 } from "lucide-react";
import { useTranslation } from "../i18n";
import { catalog, type Track } from "./catalog";
import { playInNimboMusic } from "./library";
import "./IslandDiscover.css";

/**
 * Shown on the island's music page when nothing is playing: today's top
 * songs as covers; a click plays them in Nimbo Music.
 */
export function IslandDiscover() {
  const t = useTranslation();
  const [tracks, setTracks] = useState<Track[]>([]);

  useEffect(() => {
    let cancelled = false;
    catalog
      .chart(0, t.localeTag)
      .then((chart) => !cancelled && setTracks(chart.tracks.slice(0, 20)))
      .catch((error) => console.error("Could not load the trending songs", error));
    return () => {
      cancelled = true;
    };
  }, [t.localeTag]);

  return (
    <div className="island-discover">
      <span className="island-discover__label">
        <Disc3 size={12} strokeWidth={2.4} aria-hidden="true" />
        {t.musicApp.discover}
      </span>
      <div className="island-discover__covers">
        {tracks.slice(0, 6).map((track, index) => (
          <button
            key={track.id}
            type="button"
            className="island-discover__cover"
            style={{ animationDelay: `${index * 50}ms` }}
            title={`${track.title} · ${track.artistName}`}
            aria-label={`${t.musicApp.play}: ${track.title}, ${track.artistName}`}
            onClick={(event) => {
              event.stopPropagation();
              void playInNimboMusic(tracks, index).catch((error) => console.error("Could not open Nimbo Music", error));
            }}
          >
            {track.cover && <img src={track.cover} alt="" draggable={false} />}
          </button>
        ))}
      </div>
    </div>
  );
}
