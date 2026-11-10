import SwiftUI

/// A small blob drawn by a Metal shader (`ThinkingBlob.metal`) that keeps moving while the agent works. `energy`, from 0
/// to 1, sets how lively it is. With Reduce Motion it holds still.
struct ThinkingBlob: View {
    let energy: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            let time = Float(timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600))
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
