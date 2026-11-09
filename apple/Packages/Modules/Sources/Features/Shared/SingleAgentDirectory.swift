import Backend

/// The user's agents while the server keeps one agent per user: that one agent, reached through `backend`.
nonisolated struct SingleAgentDirectory: AgentDirectory {
    let backend: any AgentBackend

    func agents() async throws(AppError) -> [AgentSummary] {
        let latest = try await backend.recentRuns(limit: 1).first
        return [AgentSummary(id: Self.id, name: "エージェント", lastRanAt: latest?.startedAt)]
    }

    func agent(id: AgentSummary.ID) -> any AgentBackend {
        backend
    }

    private static let id = "agent"
}
