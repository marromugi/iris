import Backend

/// One of the user's threads, reached through the server.
nonisolated struct ServerThread: ThreadBackend {
    let backend: IrisBackend
    let id: ChatThread.ID

    func entries(limit: Int) async throws(AppError) -> [ThreadEntry] {
        try await backend.entries(of: id, limit: limit)
    }

    func send(_ text: String) async throws(AppError) -> SentPost {
        try await backend.sendPost(text, to: id)
    }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(of: id, onOpen: onOpen, onEvent: onEvent)
    }
}
