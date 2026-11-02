import AppIntents
import Foundation

// Same as targets/widget/Shared.swift (pairing, relay call and the button intent):
// Live Activity buttons run in the app, so the app target needs its own copy.
let nimboGroup = "group.com.eduardoxdev.nimbo"

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
@available(iOS 17.0, *)
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
