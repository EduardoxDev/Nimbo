import AppIntents
import SwiftUI
import WidgetKit

/// What the home and lock screen widgets show: the paired PC's island.
struct StatusEntry: TimelineEntry {
  let date: Date
  var pc = "Nimbo"
  var title = "Nimbo"
  var subtitle = ""
  var color = "#64d2ff"
  var playing = false
  var hasMusic = false
  var focusEndsAt: Date?
  var waterPercent = 0
  var openTasks = 0
  var online = false
  /// focus, music, notice or idle: picks the mascot's mood.
  var kind = "idle"
}

private struct RemoteStatus: Decodable {
  struct Music: Decodable { let title: String; let artist: String?; let playing: Bool }
  struct Focus: Decodable { let status: String; let phase: String; let remainingMs: Double }
  struct Water: Decodable { let drankMl: Double; let goalMl: Double }
  struct Task: Decodable { let completed: Bool }
  struct Island: Decodable { let text: String; let color: String? }
  let pc: String?
  let island: Island?
  let music: Music?
  let focus: Focus?
  let water: Water?
  let tasks: [Task]?
}

private struct RemoteReply: Decodable {
  let status: RemoteStatus?
  let pcOnline: Bool?
}

struct StatusProvider: TimelineProvider {
  func placeholder(in context: Context) -> StatusEntry {
    StatusEntry(date: .now, title: "Nimbo", subtitle: "Seu PC", online: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
    completion(placeholder(in: context))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
    Task {
      let entry = await load()
      // iOS decides the real pace; asking every 15 minutes is the usual budget.
      completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
  }

  /// Fresh from the relay when possible, otherwise the last status the app saved.
  private func load() async -> StatusEntry {
    var reply: RemoteReply?
    if let pairing = Relay.pairing(), let relay = pairing.relay, let room = pairing.room, let key = pairing.key,
       let url = URL(string: "\(relay)/v1/rooms/\(room)/status?key=\(key)"),
       let (data, _) = try? await URLSession.shared.data(from: url) {
      reply = try? JSONDecoder().decode(RemoteReply.self, from: data)
    }
    if reply == nil, let text = UserDefaults(suiteName: nimboGroup)?.string(forKey: "status"), let data = text.data(using: .utf8) {
      reply = RemoteReply(status: try? JSONDecoder().decode(RemoteStatus.self, from: data), pcOnline: nil)
    }
    guard let status = reply?.status else { return StatusEntry(date: .now) }
    var entry = StatusEntry(date: .now, pc: status.pc ?? "Nimbo", online: reply?.pcOnline ?? true)
    if let island = status.island {
      entry.title = island.text
      entry.color = island.color ?? "#64d2ff"
      entry.kind = "notice"
    } else if let music = status.music {
      entry.title = music.title
      entry.subtitle = music.artist ?? ""
      entry.color = "#ff375f"
    }
    entry.hasMusic = status.music != nil
    entry.playing = status.music?.playing ?? false
    if entry.kind == "idle", status.music?.playing == true {
      entry.kind = "music"
    }
    if let focus = status.focus, focus.status == "running" {
      entry.focusEndsAt = Date.now.addingTimeInterval(focus.remainingMs / 1000)
      entry.kind = "focus"
    }
    if let water = status.water, water.goalMl > 0 {
      entry.waterPercent = Int(min(100, water.drankMl / water.goalMl * 100))
    }
    entry.openTasks = status.tasks?.filter { !$0.completed }.count ?? 0
    return entry
  }
}

struct StatusWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: StatusEntry

  var body: some View {
    switch family {
    case .accessoryRectangular:
      HStack(spacing: 6) {
        NimboMascot(size: 18)
        VStack(alignment: .leading) {
          Text(entry.title).font(.headline).lineLimit(1)
          if let end = entry.focusEndsAt {
            Text(timerInterval: Date.now...max(end, .now), countsDown: true).monospacedDigit()
          } else {
            Text("\(entry.openTasks) tarefas · \(entry.waterPercent)% água").font(.caption)
          }
        }
      }
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        NimboMascot(size: 26)
      }
    case .systemSmall:
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          NimboMascot(size: 26)
          Spacer()
          Circle().fill(entry.online ? Color(hex: "#35e985") : .gray).frame(width: 7, height: 7)
        }
        Spacer()
        Text(entry.title).font(.headline).lineLimit(2).foregroundStyle(Color(hex: entry.color))
        if let end = entry.focusEndsAt {
          Text(timerInterval: Date.now...max(end, .now), countsDown: true).font(.title2.weight(.bold)).monospacedDigit()
        } else {
          Text("\(entry.openTasks) tarefas · \(entry.waterPercent)%").font(.caption).foregroundStyle(.secondary)
        }
      }
      .foregroundStyle(.white)
    default:
      HStack(spacing: 14) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 8) {
            NimboMascot(size: 28)
            Text(entry.pc).font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Text(entry.title).font(.headline).lineLimit(2).foregroundStyle(Color(hex: entry.color))
          if !entry.subtitle.isEmpty {
            Text(entry.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 10) {
          if let end = entry.focusEndsAt {
            Text(timerInterval: Date.now...max(end, .now), countsDown: true).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(Color(hex: "#ff9f0a"))
          }
          Label("\(entry.openTasks)", systemImage: "checkmark.circle").foregroundStyle(Color(hex: "#35e985"))
          Label("\(entry.waterPercent)%", systemImage: "drop.fill").foregroundStyle(Color(hex: "#5ac8fa"))
          if entry.hasMusic {
            Button(intent: NimboCommandIntent(action: "play_pause")) {
              Image(systemName: entry.playing ? "pause.circle.fill" : "play.circle.fill").font(.title)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
          }
        }
        .font(.caption.weight(.semibold))
      }
      .foregroundStyle(.white)
    }
  }
}

struct StatusWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "NimboStatus", provider: StatusProvider()) { entry in
      StatusWidgetView(entry: entry)
        .containerBackground(.black, for: .widget)
    }
    .configurationDisplayName("Nimbo")
    .description("A ilha do seu PC: música, foco, tarefas e água.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
  }
}
