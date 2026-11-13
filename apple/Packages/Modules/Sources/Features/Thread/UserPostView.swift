import Backend
import SwiftUI

/// A post of the user's, on the right: the images it carries, then its text. A post of images alone shows no bubble.
struct UserPostView: View {
    let post: Post
    let images: PostImages
    let onOpen: (Attachment.ID) -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !post.attachments.isEmpty {
                PostImagesView(attachments: post.attachments, images: images, onOpen: onOpen)
            }
            if !post.text.isEmpty || post.attachments.isEmpty {
                UserBubble(text: post.text)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

#if DEBUG
    #Preview {
        let images = PostImages(directory: FakeAgentDirectory(images: FakeImages(Samples.pictureBytes)))
        ScrollView {
            VStack(spacing: 48) {
                UserPostView(post: Samples.mailPost, images: images, onOpen: { _ in })
                UserPostView(post: Samples.picturePost(1, text: "この写真の場所はどこ？"), images: images, onOpen: { _ in })
                UserPostView(post: Samples.picturePost(3), images: images, onOpen: { _ in })
                UserPostView(post: Samples.picturePost(4, text: "最後の 1 枚は消えた画像"), images: images, onOpen: { _ in })
            }
            .padding()
        }
    }
#endif
