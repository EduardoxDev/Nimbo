import ActivityKit
import ExpoModulesCore
import Foundation

/// Must match targets/widget/Attributes.swift exactly: iOS pairs them by name and fields.
struct NimboAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var kind: String
    var title: String
    var subtitle: String
    /// 0...1, or -1 when there is nothing to fill.
    var progress: Double
    /// When a running countdown ends, in milliseconds since 1970 (0 = none).
    var endsAt: Double
    var color: String
  }

  var name: String
}

/// Starts, updates and ends the Nimbo island on the iPhone (Live Activity),
/// and reports its push token so the relay can update it with the app closed.
public class NimboLiveModule: Module {
  private var tokenTask: Task<Void, Never>?

  private func state(_ value: [String: Any]) -> NimboAttributes.ContentState {
    NimboAttributes.ContentState(
      kind: value["kind"] as? String ?? "idle",
      title: value["title"] as? String ?? "Nimbo",
      subtitle: value["subtitle"] as? String ?? "",
      progress: (value["progress"] as? NSNumber)?.doubleValue ?? -1,
      endsAt: (value["endsAt"] as? NSNumber)?.doubleValue ?? 0,
      color: value["color"] as? String ?? "#64d2ff"
    )
  }

  @available(iOS 16.2, *)
  private func current() -> Activity<NimboAttributes>? {
    Activity<NimboAttributes>.activities.first
  }

  @available(iOS 16.2, *)
  private func watchToken(_ activity: Activity<NimboAttributes>) {
    tokenTask?.cancel()
    tokenTask = Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        let token = data.map { String(format: "%02x", $0) }.joined()
        self?.sendEvent("onPushToken", ["token": token])
      }
    }
  }

  public func definition() -> ModuleDefinition {
    Name("NimboLive")

    Events("onPushToken")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    Function("isRunning") { () -> Bool in
      if #available(iOS 16.2, *) {
        return self.current() != nil
      }
      return false
    }

    AsyncFunction("start") { (value: [String: Any]) in
      guard #available(iOS 16.2, *) else { return }
      let content = ActivityContent(state: self.state(value), staleDate: nil)
      if let activity = self.current() {
        await activity.update(content)
        self.watchToken(activity)
        return
      }
      let activity = try Activity.request(attributes: NimboAttributes(name: "Nimbo"), content: content, pushType: .token)
      self.watchToken(activity)
    }

    AsyncFunction("update") { (value: [String: Any]) in
      guard #available(iOS 16.2, *), let activity = self.current() else { return }
      await activity.update(ActivityContent(state: self.state(value), staleDate: nil))
    }

    AsyncFunction("end") { () in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<NimboAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
