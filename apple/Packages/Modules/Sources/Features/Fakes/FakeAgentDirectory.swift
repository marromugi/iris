#if DEBUG
    import Backend
    import Foundation

    /// The user's agents and threads as they are told to be, for previews: `listed` are the agents and `threads` the
    /// threads, each agent is `backend` and each thread `thread`, and listing and adding fail with `failure` when one is
    /// set. An added agent or group is given back but not listed.
    nonisolated struct FakeAgentDirectory: AgentDirectory {
        var listed = Samples.agents
        var threadsListed = Samples.threads
        var backend = FakeAgentBackend()
        var thread = FakeThreadBackend()
        var failure: AppError?

        func agents() async throws(AppError) -> [Agent] {
            if let failure { throw failure }
            return listed
        }

        func addAgent(named name: String, look: AgentLook) async throws(AppError) -> Agent {
            if let failure { throw failure }
            return Agent(id: UUID().uuidString.lowercased(), name: name, look: look, lastRanAt: nil)
        }

        func threads() async throws(AppError) -> [ChatThread] {
            if let failure { throw failure }
            return threadsListed
        }

        func addGroup(named name: String, of agentIDs: [Agent.ID]) async throws(AppError) -> ChatThread {
            if let failure { throw failure }
            return ChatThread(
                id: UUID().uuidString.lowercased(), name: name, agentId: nil, agentIds: agentIDs,
                lastActivityAt: Date())
        }

        func agent(id: Agent.ID) -> any AgentBackend {
            backend
        }

        func thread(id: ChatThread.ID) -> any ThreadBackend {
            thread
        }
    }
#endif
