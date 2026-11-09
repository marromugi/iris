import Backend

/// How a run stands, from whether it ended and whether its last attempt failed.
enum RunStatus: Equatable {
    case running
    /// An attempt failed; the server tries again.
    case retrying
    case finished
    /// It failed too many times and is not tried again.
    case gaveUp

    init(of run: Run) {
        switch (run.endedAt, run.lastError) {
        case (nil, nil): self = .running
        case (nil, _?): self = .retrying
        case (_?, nil): self = .finished
        case (_?, _?): self = .gaveUp
        }
    }

    var label: String {
        switch self {
        case .running: "実行中"
        case .retrying: "やり直し待ち"
        case .finished: "完了"
        case .gaveUp: "失敗"
        }
    }

    var systemImage: String {
        switch self {
        case .running: "hourglass"
        case .retrying: "arrow.clockwise"
        case .finished: "checkmark.circle"
        case .gaveUp: "exclamationmark.triangle"
        }
    }
}
