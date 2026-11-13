import Backend
import Foundation

@testable import Features

/// Holds reads until they are released, so a test can change what was read while one is on its way.
actor HeldReads {
    private var held: [CheckedContinuation<Void, Never>] = []
    private var waitingForHeld: [CheckedContinuation<Void, Never>] = []

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

    fileprivate func hold() async {
        await withCheckedContinuation { continuation in
            held.append(continuation)
            for continuation in waitingForHeld { continuation.resume() }
            waitingForHeld = []
        }
    }
}

/// An agent whose reads of its tasks are held until released.
struct HeldTaskReads: AgentBackend {
    let backend: FakeAgentBackend
    let reads = HeldReads()

    init(_ backend: FakeAgentBackend) {
        self.backend = backend
    }

    /// Returns once a read is being held.
    func heldRead() async { await reads.heldRead() }

    func release() async { await reads.release() }

    func tasks() async throws(AppError) -> [ScheduledTask] {
        let tasks = try await backend.tasks()
        await reads.hold()
        return tasks
    }

    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask { try await backend.addTask(task) }
    func removeTask(id: String) async throws(AppError) { try await backend.removeTask(id: id) }
    func deactivate() async throws(AppError) { try await backend.deactivate() }
    func activate() async throws(AppError) { try await backend.activate() }
}

/// A thread whose reads of its entries are held until released.
struct HeldEntryReads: ThreadBackend {
    let backend: FakeThreadBackend
    let reads = HeldReads()

    init(_ backend: FakeThreadBackend) {
        self.backend = backend
    }

    /// Returns once a read is being held.
    func heldRead() async { await reads.heldRead() }

    func release() async { await reads.release() }

    func entries(limit: Int) async throws(AppError) -> [ThreadEntry] {
        let entries = try await backend.entries(limit: limit)
        await reads.hold()
        return entries
    }

    func send(_ text: String, attaching attachmentIDs: [Attachment.ID]) async throws(AppError) -> SentPost {
        try await backend.send(text, attaching: attachmentIDs)
    }
    func canAttachImages() async throws(AppError) -> Bool { try await backend.canAttachImages() }
    func putUp(jpeg: Data) async throws(AppError) -> Attachment.ID { try await backend.putUp(jpeg: jpeg) }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(onOpen: onOpen, onEvent: onEvent)
    }
}
