import Backend
import SwiftUI

/// Where the agent's reply is about to go, while the run waits to start, starts, or thinks: the moving blob, then
/// phrases typed out and deleted one after another. With Reduce Motion the first phrase stays put.
struct ThinkingLine: View {
    /// `.running`, `.starting` or `.thinking`; it sets the phrases and how lively the blob is.
    let status: RunStatus

    @State private var startedAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let typewriter = Self.typewriter(for: status)
        HStack(spacing: 8) {
            ThinkingBlob(energy: status == .thinking ? 1 : 0.3)
            TimelineView(PeriodicTimelineSchedule(from: startedAt, by: reduceMotion ? 3600 : 0.03)) { timeline in
                let elapsed = Duration.seconds(timeline.date.timeIntervalSince(startedAt))
                Text(reduceMotion ? typewriter.phrases.first ?? "" : typewriter.text(after: elapsed))
                    .foregroundStyle(.secondary)
            }
        }
        // The typed phrases are play; VoiceOver hears what stands.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status.label)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private static func typewriter(for status: RunStatus) -> Typewriter {
        switch status {
        case .thinking:
            Typewriter(phrases: [status.label, "うーん", "お寿司食べたい", "言葉を選んでいます", "ちょっと待ってね", "コーヒー淹れたい"])
        default:
            Typewriter(phrases: [RunStatus.starting.label, "準備しています"])
        }
    }
}

#if DEBUG
    #Preview {
        VStack(alignment: .leading, spacing: 24) {
            ThinkingLine(status: .starting)
            ThinkingLine(status: .thinking)
        }
        .padding()
    }
#endif
