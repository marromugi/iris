import Backend

/// What the screens ask of one of the user's agents through `/api`, so they can be shown and tested with a fake.
nonisolated protocol AgentBackend: Sendable {
    func tasks() async throws(AppError) -> [ScheduledTask]
    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask
    func removeTask(id: String) async throws(AppError)
    func recentRuns(limit: Int) async throws(AppError) -> [Run]
    func sendMessage(_ text: String) async throws(AppError) -> Run
    /// Opens the agent's events socket, calls `onOpen` once it is open and `onEvent` for each event, and returns when
    /// the server closes it.
    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError)
}
