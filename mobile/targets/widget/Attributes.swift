import ActivityKit
import Foundation

/// Must match modules/nimbo-live/ios/NimboLiveModule.swift exactly.
struct NimboAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var kind: String
    var title: String
    var subtitle: String
    var progress: Double
    var endsAt: Double
    var color: String
  }

  var name: String
}
