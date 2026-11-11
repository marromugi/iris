import Backend

/// The user's agents and threads: which there are, and the way to reach each one.
nonisolated protocol AgentDirectory: Sendable {
    /// The user's agents, in the order they were added.
    func agents() async throws(AppError) -> [Agent]
    /// Adds an agent with the name and look, with its own one-to-one thread.
    func addAgent(named name: String, look: AgentLook) async throws(AppError) -> Agent
    /// The user's threads, the latest activity first, as the home lists them.
    func threads() async throws(AppError) -> [ChatThread]
    /// Makes a group of the agents with the name.
    func addGroup(named name: String, of agentIDs: [Agent.ID]) async throws(AppError) -> ChatThread
    /// The agent that `agents()` listed with this ID.
    func agent(id: Agent.ID) -> any AgentBackend
    /// The thread that `threads()` listed with this ID.
    func thread(id: ChatThread.ID) -> any ThreadBackend
}

extension IrisBackend: AgentDirectory {
    nonisolated func agent(id: Agent.ID) -> any AgentBackend {
        ServerAgent(backend: self, id: id)
    }

    nonisolated func thread(id: ChatThread.ID) -> any ThreadBackend {
        ServerThread(backend: self, id: id)
    }
}
