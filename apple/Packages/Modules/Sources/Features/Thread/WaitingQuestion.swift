import Backend

/// A question a run's agent asked the user, and the run that waits for the answer.
struct WaitingQuestion: Equatable {
    let runID: String
    let question: Question
}
