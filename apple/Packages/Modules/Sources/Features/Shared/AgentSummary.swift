import Foundation

/// One of the user's agents as the home lists it: what it is called, and when it last ran.
nonisolated struct AgentSummary: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    /// When its latest run started; nil until it first runs.
    let lastRanAt: Date?
}
