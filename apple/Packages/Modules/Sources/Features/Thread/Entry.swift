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

    /// Whether this is the post with the ID.
    private func isPost(_ id: String) -> Bool {
        if case .post(let post) = self { post.id == id } else { false }
    }

    var run: Run? {
        if case .run(let run) = self { run } else { nil }
    }

    /// Whether this goes after `other` in the thread: it was sent or started later; at the same time, it is a run and
    /// `other` the post it replies to; or, among runs replying to one post, its ID is greater, as the server orders them.
    func isLater(than other: Entry) -> Bool {
        (at, isRun ? 1 : 0, ownID) > (other.at, other.isRun ? 1 : 0, other.ownID)
    }

    /// Whether this is a run that replies to a post not among `shown`.
    func repliesToNone(of shown: [Entry]) -> Bool {
        guard let postID = run?.postId else { return false }
        return !shown.contains { $0.isPost(postID) }
    }

    private var at: Date {
        switch self {
        case .post(let post): post.createdAt
        case .run(let run): run.startedAt
        }
    }

    private var isRun: Bool { run != nil }

    private var ownID: String {
        switch self {
        case .post(let post): post.id
        case .run(let run): run.id
        }
    }
}
