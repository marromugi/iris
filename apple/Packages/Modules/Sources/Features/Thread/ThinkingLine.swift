import Backend
import SwiftUI

/// Where the agent's reply is about to go, while the run waits to start, starts, or thinks: the moving blob, then a
/// phrase that fades out, changes while nothing shows, and fades back in. With Reduce Motion the first phrase stays.
struct ThinkingLine: View {
    /// `.running`, `.starting` or `.thinking`; it sets the phrases and how lively the blob is.
    let status: RunStatus

    @State private var startedAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let fader = PhraseFader(phrases: [status.label] + Self.phrases(for: status))
        HStack(spacing: 8) {
            ThinkingBlob(energy: status == .thinking ? 1 : 0.4)
            TimelineView(.animation(paused: reduceMotion)) { timeline in
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

    private static func phrases(for status: RunStatus) -> [String] {
        let phrases = status == .thinking ? ThinkingPhrases.thinking : ThinkingPhrases.starting
        return phrases.filter { $0 != status.label }
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
