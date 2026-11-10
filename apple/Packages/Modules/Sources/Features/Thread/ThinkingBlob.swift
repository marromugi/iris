import SwiftUI

/// A small blob drawn by a Metal shader (`ThinkingBlob.metal`) that keeps flowing from one organic shape into the
/// next, turning and breathing, while the agent works. It is in the text's colour, so it follows light and dark.
/// `energy`, from 0 to 1, sets how lively it is. With Reduce Motion it holds still.
struct ThinkingBlob: View {
    let energy: Double

    @State private var startedAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let time = reduceMotion ? 0 : Float(timeline.date.timeIntervalSince(startedAt))
            let energy = Float(energy)
            Rectangle()
                .fill(.primary)
                .visualEffect { content, proxy in
                    content.colorEffect(
                        ShaderLibrary.bundle(.module).thinkingBlob(.float2(proxy.size), .float(time), .float(energy)))
                }
        }
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

#if DEBUG
    #Preview {
        HStack(spacing: 24) {
            ThinkingBlob(energy: 0.2)
            ThinkingBlob(energy: 1)
        }
        .padding()
    }
#endif
