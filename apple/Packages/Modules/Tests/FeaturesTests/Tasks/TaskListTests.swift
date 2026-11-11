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
        let backend = HeldTaskReads(FakeAgentBackend())
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
