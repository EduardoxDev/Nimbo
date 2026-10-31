import { Mascot } from "../mascot/Mascot";
import { MASCOT_COLORS, MASCOT_SHAPES, type MascotMood } from "../mascot/engine";

const MOODS: MascotMood[] = ["idle", "thinking", "working", "waiting", "done", "error", "sleeping"];

export default function MascotGallery() {
  return (
    <main style={{ minHeight: "100vh", padding: 24, background: "#0b0b10", color: "#f5f5f7", fontFamily: "Segoe UI, sans-serif" }}>
      <div style={{ display: "grid", gridTemplateColumns: `90px repeat(${MOODS.length}, 1fr)`, gap: 12, alignItems: "center" }}>
        <span />
        {MOODS.map((mood) => (
          <strong key={mood} style={{ fontSize: 12, textAlign: "center" }}>
            {mood}
          </strong>
        ))}
        {MASCOT_SHAPES.map((shape, row) => (
          <div key={shape} style={{ display: "contents" }}>
            <span style={{ fontSize: 12 }}>{shape}</span>
            {MOODS.map((mood) => (
              <div key={mood} style={{ display: "grid", placeItems: "center", padding: 8, background: "#000", borderRadius: 16 }}>
                <Mascot mood={mood} shape={shape} color={row === 0 ? "#f2f2f5" : MASCOT_COLORS[row % MASCOT_COLORS.length]} size={64} seed={`${shape}-${mood}`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
