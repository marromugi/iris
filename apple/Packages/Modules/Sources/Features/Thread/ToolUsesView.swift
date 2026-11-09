import SwiftUI

/// Tools the agent called one after another: closed, how many there were; open, each one and what it gave back.
struct ToolUsesView: View {
    let uses: [Conversation.ToolUse]
    @State private var isOpen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button {
                withAnimation(reduceMotion ? nil : .snappy) { isOpen.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Text("\(uses.count) 件のツールを実行")
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityValue(isOpen ? "開いています" : "閉じています")
            if isOpen {
                ToolUseTimeline(uses: uses)
            }
        }
    }
}

/// Each tool on a line, in the order it was called, with what it gave back.
private struct ToolUseTimeline: View {
    let uses: [Conversation.ToolUse]
    @ScaledMetric private var dot: CGFloat = 16

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            ForEach(uses) { use in
                HStack(alignment: .top, spacing: 14) {
                    Circle()
                        .strokeBorder(.separator, lineWidth: 1.5)
                        .background(.background, in: .circle)
                        .frame(width: dot, height: dot)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(use.name) を実行")
                            .foregroundStyle(.secondary)
                        if let result = use.result {
                            Text(result.content)
                                .foregroundStyle(result.isError ? Color.red : Color.primary)
                                .lineLimit(4)
                                .textSelection(.enabled)
                        }
                    }
                    .font(.subheadline)
                }
            }
        }
        .padding(.vertical, 8)
        .background(alignment: .leading) {
            Capsule()
                .fill(.fill.secondary)
                .frame(width: dot / 2)
                .padding(.leading, dot / 4)
        }
    }
}

#if DEBUG
    #Preview {
        ToolUsesView(uses: [
            .init(id: 0, name: "weather", result: .init(content: "{\"rain\": 0.7, \"high\": 16}", isError: false)),
            .init(id: 1, name: "calendar", result: .init(content: "The calendar could not be reached.", isError: true)),
            .init(id: 2, name: "maillist", result: nil),
        ])
        .padding()
    }
#endif
