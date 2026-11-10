import Backend

/// The user's agents: which there are, and the way to reach each one.
nonisolated protocol AgentDirectory: Sendable {
    /// The user's agents, in the order the home lists them.
    func agents() async throws(AppError) -> [AgentSummary]
    /// The agent that `agents()` listed with this ID.
    func agent(id: AgentSummary.ID) -> any AgentBackend
}
