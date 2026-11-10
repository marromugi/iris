import Backend

@testable import Features

/// Holds every read of the tasks and of the runs until it is released, so a test can change what was read while one is
/// on its way.
actor HeldReads: AgentBackend {
    private let backend: FakeAgentBackend
    private var held: [CheckedContinuation<Void, Never>] = []
    private var waitingForHeld: [CheckedContinuation<Void, Never>] = []

    init(_ backend: FakeAgentBackend) {
        self.backend = backend
    }

    /// Returns once a read is being held.
    func heldRead() async {
        guard held.isEmpty else { return }
        await withCheckedContinuation { waitingForHeld.append($0) }
    }

    func release() async {
        await heldRead()
        for continuation in held { continuation.resume() }
        held = []
    }

    func tasks() async throws(AppError) -> [ScheduledTask] {
        let tasks = try await backend.tasks()
        await hold()
        return tasks
    }

    func recentRuns(limit: Int) async throws(AppError) -> [Run] {
        let runs = try await backend.recentRuns(limit: limit)
        await hold()
        return runs
    }

    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask { try await backend.addTask(task) }
    func removeTask(id: String) async throws(AppError) { try await backend.removeTask(id: id) }
    func sendMessage(_ text: String) async throws(AppError) -> Run { try await backend.sendMessage(text) }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(onOpen: onOpen, onEvent: onEvent)
    }

    private func hold() async {
        await withCheckedContinuation { continuation in
            held.append(continuation)
            for continuation in waitingForHeld { continuation.resume() }
            waitingForHeld = []
        }
    }
}
