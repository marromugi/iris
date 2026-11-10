import Backend
import Foundation

/// A post or a run of a thread, as the thread screen keeps them.
nonisolated enum Entry: Identifiable, Equatable, Sendable {
    case post(Post)
    case run(Run)

    init(_ entry: ThreadEntry) {
        // The generator numbers the cases in the order of the oneOf in openapi.json: post, run.
        switch entry {
        case .case1(let posted): self = .post(posted.post)
        case .case2(let ran): self = .run(ran.run)
        }
    }

    /// A post's and a run's IDs can't meet, even if their values were the same.
    var id: String {
        switch self {
        case .post(let post): "post-\(post.id)"
        case .run(let run): "run-\(run.id)"
        }
    }

    var run: Run? {
        if case .run(let run) = self { run } else { nil }
    }

    /// Whether this goes after `other` in the thread: it was sent or started later, or, at the same time, it is a run
    /// and `other` the post it replies to.
    func isLater(than other: Entry) -> Bool {
        (at, isRun ? 1 : 0) > (other.at, other.isRun ? 1 : 0)
    }

    private var at: Date {
        switch self {
        case .post(let post): post.createdAt
        case .run(let run): run.startedAt
        }
    }

    private var isRun: Bool { run != nil }
}
