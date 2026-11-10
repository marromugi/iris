import Backend
import SwiftUI

/// Where the agent's reply is about to go, while the run waits to start, starts, or thinks: the moving blob, then a
/// phrase that fades out, changes while nothing shows, and fades back in, the status's own name first. With Reduce
/// Motion the name stays. A new status starts the line over, so nothing changes while it shows.
struct ThinkingLine: View {
    /// `.running`, `.starting` or `.thinking`; it sets the phrases and how lively the blob is.
    let status: RunStatus

    private static let waiting = PhraseFader(phrases: ThinkingPhrases.waiting)
    private static let starting = PhraseFader(phrases: ThinkingPhrases.starting)
    private static let thinking = PhraseFader(phrases: ThinkingPhrases.thinking)

    @State private var startedAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let fader =
            switch status {
            case .thinking: Self.thinking
            case .starting: Self.starting
            default: Self.waiting
            }
        HStack(spacing: 8) {
            ThinkingBlob(energy: status == .thinking ? 1 : 0.4)
            TimelineView(PeriodicTimelineSchedule(from: startedAt, by: reduceMotion ? 3600 : 1.0 / 30)) { timeline in
                let frame =
                    reduceMotion
                    ? (text: fader.phrase(at: 0), opacity: 1)
                    : fader.frame(after: .seconds(timeline.date.timeIntervalSince(startedAt)))
                Text(frame.text)
                    .foregroundStyle(.secondary)
                    .opacity(frame.opacity)
            }
        }
        // The phrases are play; VoiceOver hears what stands.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status.label)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
    #Preview {
        VStack(alignment: .leading, spacing: 24) {
            ThinkingLine(status: .running)
            ThinkingLine(status: .starting)
            ThinkingLine(status: .thinking)
        }
        .padding()
    }
#endif
