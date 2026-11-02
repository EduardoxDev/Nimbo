import AppIntents
import Foundation
import SwiftUI

let nimboGroup = "group.com.eduardoxdev.nimbo"

extension Color {
  init(hex: String) {
    var value: UInt64 = 0
    Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&value)
    self.init(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }
}

/// How Nimbo looks: the same moods as on the PC island.
enum NimboMood: String {
  case idle, happy, focus, sleep, alert

  /// From what the PC is doing (the widgets and the island read it from the status).
  static func of(kind: String, online: Bool = true) -> NimboMood {
    if !online { return .sleep }
    switch kind {
    case "music": return .happy
    case "focus": return .focus
    case "notice": return .alert
    default: return .idle
    }
  }
}

/// The Nimbo cloud, a union of circles like the PC mascot, filled as one shape.
struct NimboCloud: Shape {
  func path(in rect: CGRect) -> Path {
    let w = rect.width, h = rect.height
    var path = Path()
    path.addEllipse(in: CGRect(x: w * 0.10, y: h * 0.36, width: w * 0.40, height: w * 0.40))
    path.addEllipse(in: CGRect(x: w * 0.30, y: h * 0.18, width: w * 0.48, height: w * 0.48))
    path.addEllipse(in: CGRect(x: w * 0.56, y: h * 0.40, width: w * 0.34, height: w * 0.34))
    path.addRoundedRect(in: CGRect(x: w * 0.12, y: h * 0.52, width: w * 0.76, height: h * 0.24), cornerSize: CGSize(width: h * 0.12, height: h * 0.12))
    return path
  }
}

/// Nimbo drawn natively (widgets cannot run the app's SVG), with soft volume and a glow.
struct NimboMascot: View {
  var size: CGFloat = 22
  var mood: NimboMood = .idle
  var glow: Color? = nil

  var body: some View {
    ZStack {
      NimboCloud()
        .fill(LinearGradient(colors: [.white, Color(hex: "#d9dbe3")], startPoint: .top, endPoint: .bottom))
        .shadow(color: (glow ?? .white).opacity(size > 40 ? 0.45 : 0), radius: size * 0.14)
      // A soft highlight on top, like the reference's 3D look.
      NimboCloud()
        .fill(RadialGradient(colors: [.white.opacity(0.9), .clear], center: UnitPoint(x: 0.42, y: 0.32), startRadius: 0, endRadius: size * 0.42))
        .blendMode(.screen)
      Eyes(size: size, mood: mood).offset(y: size * 0.07)
    }
    .frame(width: size, height: size)
  }
}

private struct Eyes: View {
  let size: CGFloat
  let mood: NimboMood

  var body: some View {
    HStack(spacing: size * 0.15) {
      eye
      eye
    }
  }

  @ViewBuilder private var eye: some View {
    let ink = Color(hex: "#0b0b10")
    switch mood {
    case .happy:
      // ^ ^
      Arc().stroke(ink, style: StrokeStyle(lineWidth: max(1.2, size * 0.045), lineCap: .round)).frame(width: size * 0.13, height: size * 0.07)
    case .focus:
      Capsule().fill(ink).frame(width: size * 0.12, height: max(1.5, size * 0.05))
    case .sleep:
      Capsule().fill(ink.opacity(0.75)).frame(width: size * 0.12, height: max(1.2, size * 0.035)).offset(y: size * 0.03)
    case .alert:
      Circle().fill(ink).frame(width: size * 0.11, height: size * 0.11)
    case .idle:
      ZStack(alignment: .topTrailing) {
        Capsule().fill(ink).frame(width: size * 0.085, height: size * 0.19)
        if size > 40 {
          Circle().fill(.white.opacity(0.9)).frame(width: size * 0.03).offset(x: -size * 0.012, y: size * 0.03)
        }
      }
    }
  }
}

private struct Arc: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.maxY), control: CGPoint(x: rect.midX, y: rect.minY - rect.height))
    return path
  }
}

/// Where the paired PC's room is (written by the app after scanning the QR code).
struct Pairing: Codable {
  var relay: String?
  var room: String?
  var key: String?
}

enum Relay {
  static func pairing() -> Pairing? {
    guard let text = UserDefaults(suiteName: nimboGroup)?.string(forKey: "pairing"), let data = text.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Pairing.self, from: data)
  }

  /// Sends one command to the PC through the relay (works with the app closed).
  static func send(_ action: String) async {
    guard let pairing = pairing(), let relay = pairing.relay, let room = pairing.room, let key = pairing.key,
          let url = URL(string: "\(relay)/v1/rooms/\(room)/command?key=\(key)") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["action": action, "value": ""])
    _ = try? await URLSession.shared.data(for: request)
  }
}

/// A button on the widget or the island that acts on the PC: play/pause, next, focus…
struct NimboCommandIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Comando do Nimbo"
  static var isDiscoverable = false

  @Parameter(title: "Ação") var action: String

  init() {}

  init(action: String) {
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    await Relay.send(action)
    return .result()
  }
}
