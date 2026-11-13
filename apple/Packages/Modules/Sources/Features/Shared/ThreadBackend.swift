import Backend
import Foundation

/// What the thread screen asks of one of the user's threads through `/api`, so it can be shown and tested with a fake.
nonisolated protocol ThreadBackend: Sendable {
    /// The thread's latest `limit` posts and runs, latest first.
    func entries(limit: Int) async throws(AppError) -> [ThreadEntry]
    /// Sends a post with the images put up for it, by ID, and gives back the post and the runs that reply to it as they
    /// start.
    func send(_ text: String, attaching attachmentIDs: [Attachment.ID]) async throws(AppError) -> SentPost
    /// Whether posts may carry images; not while the model the agents think with can't read them.
    func canAttachImages() async throws(AppError) -> Bool
    /// Puts up a JPEG image to send with a post, and gives back its ID.
    func putUp(jpeg: Data) async throws(AppError) -> Attachment.ID
    /// Opens the thread's events socket, calls `onOpen` once it is open and `onEvent` for each event, and returns when
    /// the server closes it.
    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError)
}
