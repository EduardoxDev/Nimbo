import SwiftUI
import WidgetKit

/// Nimbo himself on the Home Screen: a big mascot whose face follows the PC
/// (happy with music, focused during a pomodoro, asleep when the PC is off).
struct MascotWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: StatusEntry

  private var mood: NimboMood { NimboMood.of(kind: entry.kind, online: entry.online) }

  private var caption: String {
    if !entry.online { return "PC dormindo" }
    switch entry.kind {
    case "focus": return "Focando"
    case "music": return entry.title
    case "notice": return entry.title
    default: return "\(entry.openTasks) tarefas"
    }
  }

  private var tint: Color {
    switch mood {
    case .happy: return Color(hex: "#ff375f")
    case .focus: return Color(hex: "#ff9f0a")
    case .alert: return Color(hex: entry.color)
    case .sleep: return Color(hex: "#5e5ce6")
    case .idle: return Color(hex: "#35e985")
    }
  }

  var body: some View {
    GeometryReader { geometry in
      let side = min(geometry.size.width, geometry.size.height)
      ZStack {
        VStack(spacing: 4) {
          Spacer(minLength: 0)
          NimboMascot(size: side * (family == .systemSmall ? 0.72 : 0.62), mood: mood, glow: tint)
          if let end = entry.focusEndsAt {
            Text(timerInterval: Date.now...max(end, .now), countsDown: true)
              .font(.caption.weight(.bold)).monospacedDigit().foregroundStyle(tint)
              .multilineTextAlignment(.center)
          } else {
            Text(caption).font(.caption2.weight(.semibold)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The status dot, like the reference: green when the PC is online.
        Circle()
          .fill(entry.online ? Color(hex: "#35e985") : .gray)
          .frame(width: 9, height: 9)
          .shadow(color: entry.online ? Color(hex: "#35e985") : .clear, radius: 4)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
    .widgetURL(URL(string: "nimbo://open"))
  }
}

struct MascotWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "NimboMascot", provider: StatusProvider()) { entry in
      MascotWidgetView(entry: entry)
        .containerBackground(for: .widget) {
          let mood = NimboMood.of(kind: entry.kind, online: entry.online)
          ZStack {
            Color(hex: "#0b0d12")
            RadialGradient(
              colors: [(mood == .sleep ? Color(hex: "#2a2a5a") : mood == .focus ? Color(hex: "#5a3a08") : mood == .happy ? Color(hex: "#5a0f22") : Color(hex: "#123a26")).opacity(0.95), .clear],
              center: .center, startRadius: 4, endRadius: 120
            )
          }
        }
    }
    .configurationDisplayName("Nimbo")
    .description("O mascote do Nimbo: muda de cara com o que o seu PC está fazendo.")
    .supportedFamilies([.systemSmall, .systemLarge])
  }
}
