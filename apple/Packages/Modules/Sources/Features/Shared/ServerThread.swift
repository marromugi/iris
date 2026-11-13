import Backend
import Foundation

/// One of the user's threads, reached through the server.
nonisolated struct ServerThread: ThreadBackend {
    let backend: IrisBackend
    let id: ChatThread.ID

    func entries(limit: Int) async throws(AppError) -> [ThreadEntry] {
        try await backend.entries(of: id, limit: limit)
    }

    func send(_ text: String, attaching attachmentIDs: [Attachment.ID]) async throws(AppError) -> SentPost {
        try await backend.sendPost(text, attaching: attachmentIDs, to: id)
    }

    func canAttachImages() async throws(AppError) -> Bool {
        try await backend.me().canAttachImages
    }

    func putUp(jpeg: Data) async throws(AppError) -> Attachment.ID {
        try await backend.putUp(jpeg: jpeg).id
    }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(of: id, onOpen: onOpen, onEvent: onEvent)
    }
}
