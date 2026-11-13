import Backend
import SwiftUI

/// A post's images opened to look at, starting at the one tapped.
struct OpenedImages: Identifiable {
    /// The post's images, in order.
    let ids: [Attachment.ID]
    /// The one tapped.
    let first: Attachment.ID

    var id: Attachment.ID { first }
}

/// A post's images one at a time on black, as large as the screen lets them be, starting at the one tapped. Swiping
/// goes to the post's other images; the button at the top closes it.
struct PostImageViewer: View {
    let opened: OpenedImages
    let images: PostImages
    @State private var current: Attachment.ID
    @Environment(\.dismiss) private var dismiss

    /// The pixels an opened image is read at: more than any screen shows, and more than the 1568 the app sends.
    static let readEdge = 4096

    init(opened: OpenedImages, images: PostImages) {
        self.opened = opened
        self.images = images
        _current = State(initialValue: opened.first)
    }

    var body: some View {
        TabView(selection: $current) {
            ForEach(opened.ids, id: \.self) { id in
                LargeImage(id: id, images: images)
                    .tag(id)
            }
        }
        #if os(iOS)
            .tabViewStyle(.page(indexDisplayMode: opened.ids.count > 1 ? .always : .never))
        #endif
        .background(.black)
        .environment(\.colorScheme, .dark)
        .overlay(alignment: .topTrailing) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.title3.weight(.semibold))
                    .padding(12)
                    .background(.thinMaterial, in: .circle)
            }
            .accessibilityLabel("閉じる")
            .padding()
        }
    }
}

/// One opened image, fitted to the screen, or the placeholder's marks while it is read or once it failed.
private struct LargeImage: View {
    let id: Attachment.ID
    let images: PostImages

    var body: some View {
        PostImageReader(id: id, longestEdge: PostImageViewer.readEdge, images: images) { phase in
            Group {
                switch phase {
                case .shown(let image):
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .scaledToFit()
                case .reading:
                    ProgressView()
                case .failed:
                    Label("表示できません", systemImage: "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("画像")
            .accessibilityValue(phase.accessibilityValue)
        }
    }
}

extension View {
    /// Shows `opened` in the image viewer over everything while it is set: full screen where the platform has it.
    func imageViewer(_ opened: Binding<OpenedImages?>, images: PostImages) -> some View {
        #if os(iOS)
            fullScreenCover(item: opened) { PostImageViewer(opened: $0, images: images) }
        #else
            sheet(item: opened) { PostImageViewer(opened: $0, images: images) }
        #endif
    }
}

#if DEBUG
    #Preview("3 枚目から") {
        PostImageViewer(
            opened: OpenedImages(ids: Samples.pictures.map(\.id), first: Samples.pictures[2].id),
            images: PostImages(directory: FakeAgentDirectory(images: FakeImages(Samples.pictureBytes))))
    }
#endif
