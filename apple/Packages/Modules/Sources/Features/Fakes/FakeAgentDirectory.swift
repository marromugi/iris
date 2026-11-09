#if DEBUG
    import Backend

    /// The user's agents as they are told to be, for previews: `listed` are the agents, and each one is `backend`.
    nonisolated struct FakeAgentDirectory: AgentDirectory {
        var listed = Samples.agents
        var backend = FakeAgentBackend()

        func agents() async throws(AppError) -> [AgentSummary] {
            listed
        }

        func agent(id: AgentSummary.ID) -> any AgentBackend {
            backend
        }
    }
#endif
