import Backend

/// The user's agents: which there are, and the way to reach each one.
nonisolated protocol AgentDirectory: Sendable {
    /// The user's agents, in the order the home lists them.
    func agents() async throws(AppError) -> [Agent]
    /// Adds an agent with the name, which `agents()` then lists last.
    func addAgent(named name: String) async throws(AppError) -> Agent
    /// The agent that `agents()` listed with this ID.
    func agent(id: Agent.ID) -> any AgentBackend
}

extension IrisBackend: AgentDirectory {
    nonisolated func agent(id: Agent.ID) -> any AgentBackend {
        ServerAgent(backend: self, id: id)
    }
}
