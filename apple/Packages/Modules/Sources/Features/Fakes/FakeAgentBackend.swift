#if DEBUG
    import Backend
    import Foundation
    import Synchronization

    /// The user's agent as it is told to be, for previews and tests: its tasks and runs start as the samples, adding,
    /// removing, and sending change them, and every call fails with `failure` when one is set.
    final class FakeAgentBackend: AgentBackend {
        struct Answers: Sendable {
            var tasks = [Samples.newsTask, Samples.weatherTask]
            var runs = [Samples.mailRun, Samples.weatherRun, Samples.retryingRun, Samples.gaveUpRun]
            var failure: AppError?
            /// When a task added here runs next.
            var nextRunAt = Samples.moment("2026-11-12T00:00:00Z")
            /// When a message sent here starts its run.
            var sentAt = Samples.moment("2026-11-10T09:00:00Z")
        }

        private let answers: Mutex<Answers>

        init(_ answers: Answers = Answers()) {
            self.answers = Mutex(answers)
        }

        func answer(_ change: @Sendable (inout Answers) -> Void) {
            answers.withLock { change(&$0) }
        }

        func tasks() async throws(AppError) -> [ScheduledTask] {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                return answers.tasks
            }
        }

        func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                let added = ScheduledTask(
                    id: "task-\(answers.tasks.count + 1)", prompt: task.prompt,
                    schedule: .init(cron: task.schedule.cron, timeZone: task.schedule.timeZone),
                    nextRunAt: answers.nextRunAt)
                answers.tasks.append(added)
                return added
            }
        }

        func removeTask(id: String) async throws(AppError) {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                answers.tasks.removeAll { $0.id == id }
            }
        }

        func recentRuns(limit: Int) async throws(AppError) -> [Run] {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                return Array(answers.runs.prefix(limit))
            }
        }

        /// Starts a run with the message alone, as the latest run; it stays going until the test changes it.
        func sendMessage(_ text: String) async throws(AppError) -> Run {
            try answers.withLock { answers throws(AppError) in
                if let failure = answers.failure { throw failure }
                let run = Run(
                    id: "sent-\(answers.runs.count + 1)", startedAt: answers.sentAt, failedAttempts: 0,
                    messages: [.case1(.init(role: .user, text: text))])
                answers.runs.insert(run, at: 0)
                return run
            }
        }
    }
#endif
