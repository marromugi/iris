import Backend
import SwiftUI

/// Where the agent's reply is about to go, while it starts or thinks: the moving blob, then phrases typed out and
/// deleted one after another. With Reduce Motion the first phrase stays put.
struct ThinkingLine: View {
    let stage: Stage

    enum Stage: Equatable {
        case starting
        case thinking

        var typewriter: Typewriter {
            switch self {
            case .starting: Typewriter(phrases: ["起動中", "準備しています"])
            case .thinking:
                Typewriter(phrases: ["考え中", "うーん", "お寿司食べたい", "言葉を選んでいます", "ちょっと待ってね", "コーヒー淹れたい"])
            }
        }

        var energy: Double {
            switch self {
            case .starting: 0.3
            case .thinking: 1
            }
        }
    }

    @State private var startedAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 8) {
            ThinkingBlob(energy: stage.energy)
            TimelineView(.periodic(from: startedAt, by: 0.03)) { timeline in
                let elapsed = Duration.seconds(timeline.date.timeIntervalSince(startedAt))
                let typewriter = stage.typewriter
                Text(reduceMotion ? typewriter.phrases.first ?? "" : typewriter.text(after: elapsed))
                    .foregroundStyle(.secondary)
            }
        }
        // The typed phrases are play; VoiceOver hears what stands.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(stage == .starting ? "起動中" : "考え中")
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#if DEBUG
    #Preview {
        VStack(alignment: .leading, spacing: 24) {
            ThinkingLine(stage: .starting)
            ThinkingLine(stage: .thinking)
        }
        .padding()
    }
#endif
