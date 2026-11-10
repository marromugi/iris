#if DEBUG
    import Backend
    import Foundation

    /// The user's agents as they are told to be, for previews: `listed` are the agents, each one is `backend`, and
    /// listing and adding fail with `failure` when one is set. An added agent is given back but not listed.
    nonisolated struct FakeAgentDirectory: AgentDirectory {
        var listed = Samples.agents
        var backend = FakeAgentBackend()
        var failure: AppError?

        func agents() async throws(AppError) -> [Agent] {
            if let failure { throw failure }
            return listed
        }

        func addAgent(named name: String) async throws(AppError) -> Agent {
            if let failure { throw failure }
            return Agent(id: UUID().uuidString.lowercased(), name: name, lastRanAt: nil)
        }

        func agent(id: Agent.ID) -> any AgentBackend {
            backend
        }
    }
#endif
