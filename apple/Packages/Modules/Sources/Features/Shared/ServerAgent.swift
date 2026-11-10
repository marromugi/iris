import Backend

/// One of the user's agents, reached through the server.
nonisolated struct ServerAgent: AgentBackend {
    let backend: IrisBackend
    let id: Agent.ID

    func tasks() async throws(AppError) -> [ScheduledTask] {
        try await backend.tasks(of: id)
    }

    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask {
        try await backend.addTask(task, to: id)
    }

    func removeTask(id taskID: String) async throws(AppError) {
        try await backend.removeTask(id: taskID, of: id)
    }

    func recentRuns(limit: Int) async throws(AppError) -> [Run] {
        try await backend.recentRuns(of: id, limit: limit)
    }

    func sendMessage(_ text: String) async throws(AppError) -> Run {
        try await backend.sendMessage(text, to: id)
    }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(of: id, onOpen: onOpen, onEvent: onEvent)
    }
}
