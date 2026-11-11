import SwiftUI

/// A small sun drawn by a Metal shader (`ThinkingBlob.metal`) that, while the agent works, has four droplets come out
/// from behind it, circle round, and melt into it from the front, swelling with each and shrinking again, over and
/// over. It is in the text's colour, so it follows light and dark. `energy`, from 0 to 1, sets how quick it is. With
/// Reduce Motion it holds still.
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
