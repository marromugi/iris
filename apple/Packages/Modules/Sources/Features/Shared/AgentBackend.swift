import Backend

/// What the screens ask of the user's agent through `/api`, so they can be shown and tested with a fake.
nonisolated protocol AgentBackend: Sendable {
    func tasks() async throws(AppError) -> [ScheduledTask]
    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask
    func removeTask(id: String) async throws(AppError)
    func recentRuns(limit: Int) async throws(AppError) -> [Run]
}

extension IrisBackend: AgentBackend {}
