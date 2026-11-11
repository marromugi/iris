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
}
