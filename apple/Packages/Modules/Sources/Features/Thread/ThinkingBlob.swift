import SwiftUI

/// A small blob drawn by a Metal shader (`ThinkingBlob.metal`) that grows, wobbles, and shrinks away, taking a new
/// organic shape each time it comes back, while the agent works. `energy`, from 0 to 1, sets how lively it is. With
/// Reduce Motion it holds still, fully grown.
struct ThinkingBlob: View {
    let energy: Double

    @State private var startedAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            // Held still, it stays in the middle of a cycle, where it is fully grown.
            let time = reduceMotion ? 1.2 : Float(timeline.date.timeIntervalSince(startedAt))
            let energy = Float(energy)
            Rectangle()
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
