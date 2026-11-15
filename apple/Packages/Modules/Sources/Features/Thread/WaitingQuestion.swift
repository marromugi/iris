import Backend

/// A question a run's agent asked the user, and the run that waits for the answer.
struct WaitingQuestion: Equatable, Identifiable {
    let runID: String
    /// How many messages the run had when it asked, which tells this question apart from the run's later ones.
    let askedAt: Int
    let question: Question

    var id: String { "\(runID)/\(askedAt)" }
}
