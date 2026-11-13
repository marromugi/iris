import Backend
import SwiftUI

/// An image picked for the next post, as a small square in the message bar: dimmed with a spinner until it is put up,
/// with a warning sign once it failed. Tapping it offers to take it off the post, and to try a failed one again.
struct AttachedImageThumbnail: View {
    let image: AttachedImage
    let onRemove: () -> Void

    static let side: CGFloat = 44

    var body: some View {
        Menu {
            if case .failed(let problem) = image.state {
                if let message = problem.message {
                    Text(message)
                }
                Button("もう一度アップロード", systemImage: "arrow.clockwise") { image.retry() }
            }
            Button("取り除く", systemImage: "xmark", role: .destructive, action: onRemove)
        } label: {
            ZStack {
                Rectangle()
                    .fill(.fill.secondary)
                if let thumbnail = image.thumbnail {
                    Image(decorative: thumbnail, scale: 1)
                        .resizable()
                        .scaledToFill()
                }
                UploadStateOverlay(state: image.state)
            }
            .frame(width: Self.side, height: Self.side)
            .clipShape(.rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("画像")
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        switch image.state {
        case .preparing, .uploading: "アップロード中"
        case .uploaded: ""
        case .failed: "アップロードできませんでした"
        }
    }
}

/// What covers a thumbnail while its image isn't put up: a spinner while it is on its way, a warning sign once it
/// failed.
private struct UploadStateOverlay: View {
    let state: AttachedImage.State

    var body: some View {
        switch state {
        case .preparing, .uploading:
            ZStack {
                Color.black.opacity(0.35)
                ProgressView()
                    .tint(.white)
            }
        case .uploaded:
            EmptyView()
        case .failed:
            ZStack {
                Color.black.opacity(0.45)
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.yellow)
            }
        }
    }
}
