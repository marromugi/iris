import Backend
import SwiftUI

/// The images a post carries, in order, on the right. One alone keeps its shape within `largestSide` points; two to
/// four are squares, two to a row, each cut from the middle of its image. Tapping one opens it.
struct PostImagesView: View {
    let attachments: [Attachment]
    let images: PostImages
    let onOpen: (Attachment.ID) -> Void

    /// The most points a lone image takes on either side.
    static let largestSide: CGFloat = 260
    /// The side of each square when there are several.
    static let squareSide: CGFloat = 120
    static let spacing: CGFloat = 4
    /// The pixels images are read at here: a lone image's `largestSide` at 3x, which also covers a square's cut.
    static let readEdge = 780

    var body: some View {
        if let only = attachments.first, attachments.count == 1 {
            PostImageButton(id: only.id, label: "画像", images: images, onOpen: onOpen) { phase in
                LoneImage(phase: phase)
            }
        } else {
            // Rows of their own rather than a grid, so a short last row keeps to the right like the post.
            VStack(alignment: .trailing, spacing: Self.spacing) {
                ForEach(rows, id: \.first?.id) { row in
                    HStack(spacing: Self.spacing) {
                        ForEach(row) { item in
                            PostImageButton(
                                id: item.attachment.id, label: "画像 \(item.number)/\(attachments.count)",
                                images: images, onOpen: onOpen
                            ) { phase in
                                SquareImage(phase: phase)
                            }
                        }
                    }
                }
            }
        }
    }

    private struct Numbered: Identifiable {
        let attachment: Attachment
        /// Its place among the post's images, from 1.
        let number: Int
        var id: Attachment.ID { attachment.id }
    }

    private var rows: [[Numbered]] {
        let numbered = attachments.enumerated().map { Numbered(attachment: $0.element, number: $0.offset + 1) }
        return stride(from: 0, to: numbered.count, by: 2).map { Array(numbered[$0..<min($0 + 2, numbered.count)]) }
    }
}

/// One of a post's images as a button that opens it, read while it is shown and drawn by `content` as it stands.
private struct PostImageButton<Content: View>: View {
    let id: Attachment.ID
    let label: String
    let images: PostImages
    let onOpen: (Attachment.ID) -> Void
    @ViewBuilder let content: (PostImagePhase) -> Content

    var body: some View {
        Button {
            onOpen(id)
        } label: {
            PostImageReader(id: id, longestEdge: PostImagesView.readEdge, images: images) { phase in
                content(phase)
                    .clipShape(.rect(cornerRadius: 12))
                    .contentShape(.rect(cornerRadius: 12))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(label)
                    .accessibilityValue(phase.accessibilityValue)
            }
        }
        .buttonStyle(.plain)
    }
}

/// One of a post's images, read upright at `longestEdge` pixels while it is shown, and drawn by `content` as it
/// stands.
struct PostImageReader<Content: View>: View {
    let id: Attachment.ID
    let longestEdge: Int
    let images: PostImages
    @ViewBuilder let content: (PostImagePhase) -> Content

    @State private var phase = PostImagePhase.reading

    var body: some View {
        content(phase)
            .task(id: id) {
                let next = await images.phase(of: id, longestEdge: longestEdge)
                if !Task.isCancelled { phase = next }
            }
    }
}

/// A lone image, its whole shape shown, or a square placeholder while it is read or once it failed.
private struct LoneImage: View {
    let phase: PostImagePhase

    var body: some View {
        switch phase {
        case .shown(let image):
            Image(decorative: image, scale: 1)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: PostImagesView.largestSide, maxHeight: PostImagesView.largestSide)
        case .reading, .failed:
            ImagePlaceholder(phase: phase)
                .frame(width: PostImagesView.largestSide * 0.7, height: PostImagesView.largestSide * 0.7)
        }
    }
}

/// One of several images, as a square cut from its middle.
private struct SquareImage: View {
    let phase: PostImagePhase

    var body: some View {
        ImagePlaceholder(phase: phase)
            .overlay {
                if case .shown(let image) = phase {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .scaledToFill()
                }
            }
            .frame(width: PostImagesView.squareSide, height: PostImagesView.squareSide)
    }
}

/// What stands where an image goes until it is shown: a spinner while it is read, a quiet mark once it can't be.
struct ImagePlaceholder: View {
    let phase: PostImagePhase

    var body: some View {
        Rectangle()
            .fill(.fill.tertiary)
            .overlay {
                switch phase {
                case .reading:
                    ProgressView()
                case .failed:
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(.tertiary)
                case .shown:
                    EmptyView()
                }
            }
    }
}

extension PostImagePhase {
    var accessibilityValue: String {
        switch self {
        case .reading: "読み込み中"
        case .shown: ""
        case .failed: "表示できません"
        }
    }
}

#if DEBUG
    private let images = PostImages(directory: FakeAgentDirectory(images: FakeImages(Samples.pictureBytes)))

    #Preview("1 枚ずつ") {
        ScrollView {
            VStack(alignment: .trailing, spacing: 24) {
                ForEach(Samples.pictures) { picture in
                    PostImagesView(attachments: [picture], images: images, onOpen: { _ in })
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding()
        }
    }

    #Preview("2〜4 枚") {
        ScrollView {
            VStack(alignment: .trailing, spacing: 24) {
                ForEach(2...4, id: \.self) { count in
                    PostImagesView(
                        attachments: Array(Samples.pictures.prefix(count)), images: images, onOpen: { _ in })
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding()
        }
    }
#endif
