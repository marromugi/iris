import Backend

/// How a run stands: from whether it ended, whether its last attempt failed, and whether it waits for the user's answer,
/// and while it is carried on, from how the events socket says it is getting on.
enum RunStatus: Hashable {
    case running
    /// Its agent asked the user a question and waits, however long, for the answer.
    case waitingForAnswer
    /// Picked up, and about to ask the model.
    case starting
    /// The model is asked and hasn't written anything of its message yet.
    case thinking
    /// The model is writing its message.
    case writing
    /// An attempt failed; the server tries again.
    case retrying
    case finished
    /// It failed too many times and is not tried again.
    case gaveUp

    init(of run: Run, progress: RunProgress? = nil) {
        switch (run.endedAt, run.lastError, progress) {
        case (nil, _, nil) where run.question != nil: self = .waitingForAnswer
        case (nil, _, .case1?): self = .starting
        case (nil, _, .case2?): self = .thinking
        case (nil, _, .case3?): self = .writing
        case (nil, nil, nil): self = .running
        case (nil, _?, nil): self = .retrying
        case (_?, nil, _): self = .finished
        case (_?, _?, _): self = .gaveUp
        }
    }

    var label: String {
        switch self {
        case .running: "実行中"
        case .waitingForAnswer: "答え待ち"
        case .starting: "起動中"
        case .thinking: "考え中"
        case .writing: "書いています"
        case .retrying: "やり直し待ち"
        case .finished: "完了"
        case .gaveUp: "失敗"
        }
    }

    var systemImage: String {
        switch self {
        case .running, .starting: "hourglass"
        case .waitingForAnswer: "questionmark.bubble"
        case .thinking: "ellipsis.bubble"
        case .writing: "pencil"
        case .retrying: "arrow.clockwise"
        case .finished: "checkmark.circle"
        case .gaveUp: "exclamationmark.triangle"
        }
    }
}
