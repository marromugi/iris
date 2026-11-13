import PhotosUI
import SwiftUI

/// Where the user writes a message to the agent, picks images to go with it, and sends it.
///
/// The add button, the field, and the send button sit in one rounded box. While the text fits on
/// one line and no image is picked they share a row; otherwise the field takes the full width on
/// top and the buttons move to a row below it, with the images picked between them.
struct MessageBar: View {
    @Binding var text: String
    let canSend: Bool
    /// The images picked for the message, in the order picked.
    let images: [AttachedImage]
    /// How many more images can be picked; none disables the add button.
    let imagesLeft: Int
    let onPick: ([PhotosPickerItem]) -> Void
    let onRemove: (AttachedImage) -> Void
    let onSend: () -> Void

    var body: some View {
        MessageBarLayout(hasImages: !images.isEmpty) {
            // The picker hands its picks over once and keeps none, so each opening starts empty. A
            // limit of 0 would mean no limit; the button is disabled then anyway.
            PhotosPicker(
                selection: Binding(get: { [] }, set: onPick), maxSelectionCount: max(imagesLeft, 1),
                selectionBehavior: .ordered, matching: .images
            ) {
                Label("画像を追加", systemImage: "plus")
                    .labelStyle(.iconOnly)
                    .font(.system(size: 20))
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .disabled(imagesLeft == 0)
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
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(images) { image in
                        AttachedImageThumbnail(image: image) { onRemove(image) }
                    }
                }
            }
            .scrollIndicators(.hidden)
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

/// Places the add button, the field, the send button, and the images picked: the first three in
/// one row while there are no images and the text fits on one line between the buttons, otherwise
/// the field on top and the buttons in a row below with the images between them. The last two
/// subviews are hidden text used only for measuring: a copy of the field's text, and one line.
private struct MessageBarLayout: Layout {
    let hasImages: Bool
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
        guard subviews.count == 6 else { return (.zero, []) }
        let add = subviews[0].sizeThatFits(.unspecified)
        let send = subviews[2].sizeThatFits(.unspecified)
        let buttonHeight = max(add.height, send.height)
        let lineHeight = subviews[5].sizeThatFits(.unspecified).height
        func textHeight(width: CGFloat) -> CGFloat {
            subviews[4].sizeThatFits(ProposedViewSize(width: width, height: nil)).height
        }

        // Between the buttons: the field in one row, or the images in the row below.
        let betweenWidth = max(width - add.width - send.width - spacing * 2, 0)
        if !hasImages, textHeight(width: betweenWidth - cursorRoom) <= lineHeight {
            let rowField = CGSize(width: betweenWidth, height: lineHeight)
            let height = max(buttonHeight, rowField.height)
            return (
                CGSize(width: width, height: height),
                [
                    CGRect(x: 0, y: (height - add.height) / 2, width: add.width, height: add.height),
                    CGRect(
                        x: add.width + spacing, y: (height - rowField.height) / 2,
                        width: betweenWidth, height: rowField.height),
                    CGRect(
                        x: width - send.width, y: (height - send.height) / 2,
                        width: send.width, height: send.height),
                    .zero, .zero, .zero,
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
                hasImages
                    ? CGRect(x: add.width + spacing, y: rowY, width: betweenWidth, height: buttonHeight) : .zero,
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
            MessageBar(text: $text, canSend: false, images: [], imagesLeft: 4, onPick: { _ in }, onRemove: { _ in }) {}
        }
    }

    #Preview("1 行") {
        @Previewable @State var text = "確認した結果、追加で調査が必要とわか"
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: true, images: [], imagesLeft: 4, onPick: { _ in }, onRemove: { _ in }) {}
        }
    }

    #Preview("複数行") {
        @Previewable @State var text = "確認した結果、追加で調査が必要とわかりました。改めて確認します。"
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: true, images: [], imagesLeft: 4, onPick: { _ in }, onRemove: { _ in }) {}
        }
    }

    #Preview("画像あり") {
        @Previewable @State var open = OpenThread(backend: FakeThreadBackend())
        VStack {
            Spacer()
            MessageBar(
                text: $open.draft, canSend: false, images: open.images, imagesLeft: open.imagesLeft,
                onPick: { _ in }, onRemove: { open.remove($0) }
            ) {}
        }
        .task {
            await open.checkImageAttaching()
            open.draft = "確認した結果、追加で調査が必要とわかりました。改めて確認します。"
            open.attach([
                FakePickedImage(),
                FakePickedImage(bytes: Samples.photo(width: 1200, height: 1600, from: (0.4, 0.8, 0.6))),
                FakePickedImage(gate: FakePickedImage.Gate()),
                FakePickedImage(failure: .offline),
            ])
        }
    }
#endif
