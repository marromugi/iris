import Backend

/// What the screens ask of one of the user's agents through `/api`, so they can be shown and tested with a fake.
nonisolated protocol AgentBackend: Sendable {
    func tasks() async throws(AppError) -> [ScheduledTask]
    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask
    func removeTask(id: String) async throws(AppError)
    /// Stops the agent replying and running its tasks, keeping everything it has.
    func deactivate() async throws(AppError)
    /// Lets the agent reply and run its tasks again.
    func activate() async throws(AppError)
}
