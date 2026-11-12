import SwiftUI

/// Where the user writes a message to the agent and sends it.
///
/// The add button, the field, and the send button sit in one rounded box. While the text fits on
/// one line they share a row; once it needs more, the field takes the full width on top and the
/// buttons move to a row below it.
struct MessageBar: View {
    @Binding var text: String
    let canSend: Bool
    let onSend: () -> Void

    var body: some View {
        MessageBarLayout {
            // Attaching is not built yet; the button holds its place in the box.
            Button("追加", systemImage: "plus") {}
                .labelStyle(.iconOnly)
                .font(.system(size: 20))
                .frame(width: 32, height: 32)
                .disabled(true)
            TextField("メッセージ", text: $text, axis: .vertical)
                .lineLimit(1...5)
            Button(action: onSend) {
                Image(systemName: "paperplane")
                    .rotationEffect(.degrees(45))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.background)
                    .frame(width: 44, height: 44)
                    .background(.primary, in: .circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("送信")
            .opacity(canSend ? 1 : 0.3)
            .disabled(!canSend)
            // The field reports its current height at any proposed width while it is being edited,
            // so the layout measures hidden copies instead: the text (a trailing space keeps a final
            // line break from collapsing) and one line.
            Text(text + " ")
                .lineLimit(5)
                .hidden()
            Text(" ")
                .hidden()
        }
        .padding(8)
        .background(.fill.tertiary, in: .rect(cornerRadius: 30))
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.background)
    }
}

/// Places the add button, the field, and the send button: in one row while the text fits on one
/// line between the buttons, otherwise the field on top and the buttons in a row below. The last
/// two subviews are hidden text used only for measuring: a copy of the field's text, and one line.
private struct MessageBarLayout: Layout {
    private let spacing: CGFloat = 8
    /// How far the stacked field sits in from the box's padding, so its text lines up with the
    /// add button's icon.
    private let fieldInset: CGFloat = 8
    /// Room kept free at the end of the row's field, so the cursor never touches the send button.
    private let cursorRoom: CGFloat = 12

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(width: proposal.width ?? 320, subviews: subviews).size
    }

    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        let frames = arrangement(width: bounds.width, subviews: subviews).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrangement(width: CGFloat, subviews: Subviews) -> (
        size: CGSize, frames: [CGRect]
    ) {
        guard subviews.count == 5 else { return (.zero, []) }
        let add = subviews[0].sizeThatFits(.unspecified)
        let send = subviews[2].sizeThatFits(.unspecified)
        let buttonHeight = max(add.height, send.height)
        let lineHeight = subviews[4].sizeThatFits(.unspecified).height
        func textHeight(width: CGFloat) -> CGFloat {
            subviews[3].sizeThatFits(ProposedViewSize(width: width, height: nil)).height
        }

        let rowFieldWidth = max(width - add.width - send.width - spacing * 2, 0)
        if textHeight(width: rowFieldWidth - cursorRoom) <= lineHeight {
            let rowField = CGSize(width: rowFieldWidth, height: lineHeight)
            let height = max(buttonHeight, rowField.height)
            return (
                CGSize(width: width, height: height),
                [
                    CGRect(x: 0, y: (height - add.height) / 2, width: add.width, height: add.height),
                    CGRect(
                        x: add.width + spacing, y: (height - rowField.height) / 2,
                        width: rowFieldWidth, height: rowField.height),
                    CGRect(
                        x: width - send.width, y: (height - send.height) / 2,
                        width: send.width, height: send.height),
                    .zero, .zero,
                ]
            )
        }

        let fieldWidth = max(width - fieldInset * 2, 0)
        let fieldHeight = textHeight(width: fieldWidth)
        let rowY = fieldInset + fieldHeight + spacing * 2
        return (
            CGSize(width: width, height: rowY + buttonHeight),
            [
                CGRect(
                    x: 0, y: rowY + (buttonHeight - add.height) / 2,
                    width: add.width, height: add.height),
                CGRect(x: fieldInset, y: fieldInset, width: fieldWidth, height: fieldHeight),
                CGRect(
                    x: width - send.width, y: rowY + (buttonHeight - send.height) / 2,
                    width: send.width, height: send.height),
                .zero, .zero,
            ]
        )
    }
}

#if DEBUG
    #Preview("空") {
        @Previewable @State var text = ""
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: false) {}
        }
    }

    #Preview("1 行") {
        @Previewable @State var text = "確認した結果、追加で調査が必要とわか"
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: true) {}
        }
    }

    #Preview("複数行") {
        @Previewable @State var text = "確認した結果、追加で調査が必要とわかりました。改めて確認します。"
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: true) {}
        }
    }
#endif
