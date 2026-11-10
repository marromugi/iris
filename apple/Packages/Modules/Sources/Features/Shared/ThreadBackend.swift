import Backend

/// What the thread screen asks of one of the user's threads through `/api`, so it can be shown and tested with a fake.
nonisolated protocol ThreadBackend: Sendable {
    /// The thread's latest `limit` posts and runs, latest first.
    func entries(limit: Int) async throws(AppError) -> [ThreadEntry]
    /// Sends a post, and gives back the post and the runs that reply to it as they start.
    func send(_ text: String) async throws(AppError) -> SentPost
    /// Opens the thread's events socket, calls `onOpen` once it is open and `onEvent` for each event, and returns when
    /// the server closes it.
    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError)
}
