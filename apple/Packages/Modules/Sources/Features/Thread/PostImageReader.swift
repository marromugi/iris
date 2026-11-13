import Backend
import SwiftUI

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
