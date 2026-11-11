#if DEBUG
    import Backend
    import Foundation
    import Synchronization

    /// The user's agent as it is told to be, for previews and tests: its tasks start as the samples, adding and removing
    /// change them, and every call fails with `failure` when one is set.
    final class FakeAgentBackend: AgentBackend {
        struct Answers: Sendable {
            var tasks = [Samples.newsTask, Samples.weatherTask]
            var failure: AppError?
            /// When a task added here runs next.
            var nextRunAt = Samples.moment("2026-11-12T00:00:00Z")
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
    }
#endif
