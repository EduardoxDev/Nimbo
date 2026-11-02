import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// The Nimbo island on the iPhone: Dynamic Island and lock screen.
struct NimboLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NimboAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(.black)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let state = context.state
      let accent = Color(hex: state.color)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          NimboMascot(size: 38, mood: NimboMood.of(kind: state.kind), glow: accent).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Trailing(state: state).font(.title3.weight(.semibold)).foregroundStyle(accent).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text(state.title).font(.headline).lineLimit(1)
            if !state.subtitle.isEmpty {
              Text(state.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            if state.progress >= 0 {
              ProgressView(value: state.progress).tint(accent)
            }
            Controls(kind: state.kind, accent: accent)
          }
        }
      } compactLeading: {
        NimboMascot(size: 22, mood: NimboMood.of(kind: state.kind))
      } compactTrailing: {
        Trailing(state: state).font(.caption.weight(.semibold)).foregroundStyle(accent).frame(maxWidth: 52)
      } minimal: {
        NimboMascot(size: 20, mood: NimboMood.of(kind: state.kind))
      }
      .keylineTint(accent)
    }
  }
}

/// A live countdown for focus (iOS ticks it, no pushes needed), a wave for music.
private struct Trailing: View {
  let state: NimboAttributes.ContentState

  var body: some View {
    if state.kind == "focus", state.endsAt > 0 {
      let end = Date(timeIntervalSince1970: state.endsAt / 1000)
      Text(timerInterval: Date.now...max(end, Date.now), countsDown: true).monospacedDigit().multilineTextAlignment(.trailing)
    } else if state.kind == "music" {
      Image(systemName: "waveform")
    } else if state.kind == "notice" {
      Image(systemName: "bell.fill")
    } else {
      Image(systemName: "circle.fill").font(.system(size: 6))
    }
  }
}

private struct Controls: View {
  let kind: String
  let accent: Color

  var body: some View {
    HStack(spacing: 22) {
      if kind == "focus" {
        Button(intent: NimboCommandIntent(action: "focus_pause")) { Image(systemName: "pause.fill") }
        Button(intent: NimboCommandIntent(action: "focus_skip")) { Image(systemName: "forward.end.fill") }
      } else {
        Button(intent: NimboCommandIntent(action: "previous")) { Image(systemName: "backward.fill") }
        Button(intent: NimboCommandIntent(action: "play_pause")) { Image(systemName: "playpause.fill") }
        Button(intent: NimboCommandIntent(action: "next")) { Image(systemName: "forward.fill") }
      }
    }
    .buttonStyle(.plain)
    .font(.title3)
    .foregroundStyle(.white)
  }
}

private struct LockScreenView: View {
  let state: NimboAttributes.ContentState

  var body: some View {
    let accent = Color(hex: state.color)
    VStack(spacing: 10) {
      HStack(spacing: 12) {
        NimboMascot(size: 52, mood: NimboMood.of(kind: state.kind), glow: accent)
        VStack(alignment: .leading, spacing: 2) {
          Text(state.title).font(.headline).lineLimit(1)
          if !state.subtitle.isEmpty {
            Text(state.subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        Spacer()
        Trailing(state: state).font(.title2.weight(.semibold)).foregroundStyle(accent)
      }
      if state.progress >= 0 {
        ProgressView(value: state.progress).tint(accent)
      }
      Controls(kind: state.kind, accent: accent)
    }
    .padding(16)
    .foregroundStyle(.white)
  }
}
