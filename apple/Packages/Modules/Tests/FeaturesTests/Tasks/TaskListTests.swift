import Backend
import Foundation
import Testing

@testable import Features

struct TaskListTests {
    let tokyo = NewTask(prompt: "ニュースをまとめて", schedule: .init(cron: "0 6 * * *", timeZone: "Asia/Tokyo"))

    @Test func readsTheTasks() async {
        let list = TaskList(backend: FakeAgentBackend())

        await list.load()

        #expect(list.shown.value?.map(\.id) == [Samples.newsTask.id, Samples.weatherTask.id])
    }

    @Test func putsAnAddedTaskInOrderOfItsNextRun() async throws {
        let backend = FakeAgentBackend()
        backend.answer { $0.nextRunAt = Samples.moment("2026-11-10T21:00:00Z") }
        let list = TaskList(backend: backend)
        await list.load()

        try await list.add(tokyo)

        #expect(list.shown.value?.map(\.prompt) == [Samples.newsTask.prompt, "ニュースをまとめて", Samples.weatherTask.prompt])
    }

    @Test func removingHidesTheTaskAtOnceAndDropsItOnceTheServerRemovesIt() async {
        let list = TaskList(backend: FakeAgentBackend())
        await list.load()

        let removal = list.remove(Samples.weatherTask)
        let hidden = list.shown.value?.map(\.id)
        await removal.value

        #expect(hidden == [Samples.newsTask.id])
        #expect(list.shown.value?.map(\.id) == [Samples.newsTask.id])
    }

    @Test func aRemovalThatDoesNotGoThroughBringsTheTaskBackAndSaysWhy() async {
        let backend = FakeAgentBackend()
        let list = TaskList(backend: backend)
        await list.load()
        backend.answer { $0.failure = .refused(message: "Something went wrong") }

        await list.remove(Samples.weatherTask).value

        #expect(list.shown.value?.map(\.id) == [Samples.newsTask.id, Samples.weatherTask.id])
        #expect(list.removalProblem == .refused(message: "Something went wrong"))
        #expect(list.isShowingRemovalProblem)
    }

    @Test func aRemovalTheServerRefusesTheSignInForOffersToSignInAgain() async {
        let backend = FakeAgentBackend()
        let list = TaskList(backend: backend)
        await list.load()
        backend.answer { $0.failure = .signedOut }

        await list.remove(Samples.weatherTask).value

        #expect(list.tasks.failure == .signedOut)
        #expect(list.removalProblem == nil)
    }

    @Test func anAddTheServerRefusesTheSignInForOffersToSignInAgain() async {
        let backend = FakeAgentBackend()
        let list = TaskList(backend: backend)
        await list.load()
        backend.answer { $0.failure = .signedOut }

        await #expect(throws: AppError.signedOut) { try await list.add(tokyo) }
        #expect(list.tasks.failure == .signedOut)
    }

    @Test func aReadThatStartedBeforeARemovalIsDropped() async {
        let backend = HeldReads(FakeAgentBackend())
        let list = TaskList(backend: backend)
        let firstRead = Task { await list.load() }
        await backend.release()
        await firstRead.value

        let staleRead = Task { await list.load() }
        await backend.heldRead()
        await list.remove(Samples.weatherTask).value
        await backend.release()
        await staleRead.value

        #expect(list.shown.value?.map(\.id) == [Samples.newsTask.id])
    }
}

/// Holds every read of the tasks until it is released, so a test can change the list while one is on its way.
private actor HeldReads: AgentBackend {
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
        await withCheckedContinuation { continuation in
            held.append(continuation)
            for continuation in waitingForHeld { continuation.resume() }
            waitingForHeld = []
        }
        return tasks
    }

    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask { try await backend.addTask(task) }
    func removeTask(id: String) async throws(AppError) { try await backend.removeTask(id: id) }
    func recentRuns() async throws(AppError) -> [Run] { try await backend.recentRuns() }
}

extension Loadable {
    fileprivate var value: Value? {
        if case .loaded(let value) = self { value } else { nil }
    }

    fileprivate var failure: AppError? {
        if case .failed(let error) = self { error } else { nil }
    }
}
