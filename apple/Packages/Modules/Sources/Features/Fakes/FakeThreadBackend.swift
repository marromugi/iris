#if DEBUG
    import Backend
    import Foundation
    import Synchronization

    /// A thread as it is told to be, for previews and tests: its runs and the posts they reply to start as the samples,
    /// sending adds a post with a run of each of `repliers` replying to it, and every call fails with `failure` when one
    /// is set. Its events socket stays open with nothing said until the test says something with `hear(_:)` or closes it
    /// with `closeSocket()`.
    final class FakeThreadBackend: ThreadBackend {
        struct Answers: Sendable {
            var runs = [Samples.mailRun, Samples.weatherRun, Samples.retryingRun, Samples.gaveUpRun]
            var posts = [Samples.mailPost, Samples.gaveUpPost]
            /// The agents whose runs reply to a post sent here.
            var repliers = ["1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e"]
            var failure: AppError?
            /// When a post sent here is made, and its runs start.
            var sentAt = Samples.moment("2026-11-10T09:00:00Z")
            /// How many times the events socket was opened.
            var socketsOpened = 0
            /// The events socket that is open, if one is.
            var socket: AsyncStream<RunEvent>.Continuation?
        }

        private let answers: Mutex<Answers>

        init(_ answers: Answers = Answers()) {
            self.answers = Mutex(answers)
        }

        func answer(_ change: @Sendable (inout Answers) -> Void) {
            answers.withLock { change(&$0) }
        }

        func entries(limit: Int) async throws(AppError) -> [ThreadEntry] {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                let entries =
                    answers.posts.map { Entry.post($0) } + answers.runs.map { Entry.run($0) }
                return
                    entries
                    .sorted { $0.isLater(than: $1) }
                    .prefix(limit)
                    .map {
                        switch $0 {
                        case .post(let post): .case1(.init(_type: .post, post: post))
                        case .run(let run): .case2(.init(_type: .run, run: run))
                        }
                    }
            }
        }

        /// Makes a post with a run of each replier that has the text alone; the runs stay going until the test changes
        /// them.
        func send(_ text: String) async throws(AppError) -> SentPost {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                let post = Post(id: "post-\(answers.posts.count + 1)", text: text, createdAt: answers.sentAt)
                let runs = answers.repliers.enumerated().map { index, agentID in
                    Run(
                        id: "sent-\(answers.runs.count + index + 1)", agentId: agentID, postId: post.id,
                        startedAt: answers.sentAt, failedAttempts: 0,
                        messages: [.case1(.init(role: .user, text: text))])
                }
                answers.posts.append(post)
                answers.runs.insert(contentsOf: runs, at: 0)
                return SentPost(post: post, runs: runs)
            }
        }

        func followEvents(
            onOpen: @Sendable () async -> Void,
            onEvent: @Sendable (RunEvent) async -> Void
        ) async throws(AppError) {
            let (events, socket) = AsyncStream.makeStream(of: RunEvent.self)
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                answers.socket = socket
                answers.socketsOpened += 1
            }
            await onOpen()
            for await event in events {
                await onEvent(event)
            }
        }

        /// How many times the events socket was opened.
        var socketsOpened: Int {
            answers.withLock { $0.socketsOpened }
        }

        /// Says `event` on the events socket that is open.
        func hear(_ event: RunEvent) {
            answers.withLock { _ = $0.socket?.yield(event) }
        }

        /// Closes the events socket, as the server does.
        func closeSocket() {
            answers.withLock {
                $0.socket?.finish()
                $0.socket = nil
            }
        }
    }
#endif
