#if DEBUG
    import Backend

    /// The user's agents as they are told to be, for previews: `listed` are the agents, each one is `backend`, and
    /// listing fails with `failure` when one is set.
    nonisolated struct FakeAgentDirectory: AgentDirectory {
        var listed = Samples.agents
        var backend = FakeAgentBackend()
        var failure: AppError?

        func agents() async throws(AppError) -> [Agent] {
            if let failure { throw failure }
            return listed
        }

        func agent(id: Agent.ID) -> any AgentBackend {
            backend
        }
    }
#endif
