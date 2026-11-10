import Backend
import Foundation
import Testing

@testable import Features

struct AgentThreadTests {
    @Test func sendingPutsTheRunItStartsAtTheEndOfTheThreadAndEmptiesTheField() async throws {
        let thread = AgentThread(backend: FakeAgentBackend())
        await thread.load()
        thread.draft = "請求書の件、返信の下書きを作って。"

        await thread.send()?.value

        let latest = try #require(thread.runs.value?.first)
        #expect(latest.taskId == nil)
        #expect(Conversation(latest.messages).prompt == "請求書の件、返信の下書きを作って。")
        #expect(thread.runs.value?.count == 5)
        #expect(thread.draft.isEmpty)
        #expect(thread.hasRunGoing)
    }

    @Test func sendsNothingForAFieldWithOnlySpaces() async {
        let thread = AgentThread(backend: FakeAgentBackend())
        await thread.load()
        thread.draft = "  \n"

        #expect(thread.send() == nil)
        #expect(thread.runs.value?.count == 4)
    }

    @Test func aMessageThatDoesNotGoThroughGoesBackToTheFieldAndSaysWhy() async {
        let backend = FakeAgentBackend()
        let thread = AgentThread(backend: backend)
        await thread.load()
        backend.answer { $0.failure = .refused(message: "Something went wrong") }
        thread.draft = "こんにちは"

        await thread.send()?.value

        #expect(thread.draft == "こんにちは")
        #expect(thread.sendProblem == .refused(message: "Something went wrong"))
        #expect(thread.isShowingSendProblem)
        #expect(thread.runs.value?.count == 4)
    }

    @Test func aMessageThatDoesNotGoThroughGoesBeforeWhatWasWrittenSince() async {
        let backend = HeldSends(FakeAgentBackend())
        let thread = AgentThread(backend: backend)
        await thread.load()
        thread.draft = "1 通目"

        let sending = thread.send()
        await backend.heldSend()
        thread.draft = "2 通目"
        await backend.fail(with: .offline)
        await sending?.value

        #expect(thread.draft == "1 通目\n2 通目")
    }

    @Test func aRunAReadAlreadyBroughtIsNotShownTwice() async {
        let backend = HeldSends(FakeAgentBackend())
        let thread = AgentThread(backend: backend)
        await thread.load()
        thread.draft = "こんにちは"

        let sending = thread.send()
        await backend.heldSend()
        await thread.load()
        await backend.release()
        await sending?.value

        let ids = thread.runs.value?.map(\.id) ?? []
        #expect(ids.count == 5)
        #expect(Set(ids).count == ids.count)
    }

    @Test func aMessageTheServerRefusesTheSignInForOffersToSignInAgain() async {
        let backend = FakeAgentBackend()
        let thread = AgentThread(backend: backend)
        await thread.load()
        backend.answer { $0.failure = .signedOut }
        thread.draft = "こんにちは"

        await thread.send()?.value

        #expect(thread.runs.failure == .signedOut)
        #expect(thread.sendProblem == nil)
    }

    @Test func readsAgainOnlyWhileARunIsGoing() async {
        let backend = FakeAgentBackend(.init(runs: [Samples.sentRun, Samples.mailRun]))
        let thread = AgentThread(backend: backend)
        await thread.load()
        let answered = {
            var run = Samples.sentRun
            run.endedAt = Samples.moment("2026-11-10T00:05:09Z")
            return run
        }()
        backend.answer { $0.runs[0] = answered }

        await thread.readAgainIfGoing()
        let afterReply = thread.runs.value?.first?.endedAt
        backend.answer { $0.runs.insert(Samples.weatherRun, at: 0) }
        await thread.readAgainIfGoing()

        #expect(afterReply == answered.endedAt)
        #expect(thread.runs.value?.map(\.id) == [Samples.sentRun.id, Samples.mailRun.id])
    }

    @Test func aRunWaitingToBeTriedAgainIsReadAgainToo() async {
        let backend = FakeAgentBackend(.init(runs: [Samples.retryingRun]))
        let thread = AgentThread(backend: backend)
        await thread.load()
        backend.answer { $0.runs.insert(Samples.weatherRun, at: 0) }

        await thread.readAgainIfGoing()

        #expect(thread.runs.value?.map(\.id) == [Samples.weatherRun.id, Samples.retryingRun.id])
    }

    @Test func aReadThatStartedBeforeAMessageWentThroughIsDropped() async {
        let backend = HeldReads(FakeAgentBackend())
        let thread = AgentThread(backend: backend)
        let firstRead = Task { await thread.load() }
        await backend.release()
        await firstRead.value

        let staleRead = Task { await thread.load() }
        await backend.heldRead()
        thread.draft = "こんにちは"
        await thread.send()?.value
        await backend.release()
        await staleRead.value

        #expect(thread.runs.value?.count == 5)
    }
}

/// Holds every message sent once the agent has started its run, as the server does before it answers, until the test
/// lets the answer through or fails it.
private actor HeldSends: AgentBackend {
    private let backend: FakeAgentBackend
    private var held: CheckedContinuation<AppError?, Never>?
    private var waitingForHeld: [CheckedContinuation<Void, Never>] = []

    init(_ backend: FakeAgentBackend) {
        self.backend = backend
    }

    /// Returns once a message is being held.
    func heldSend() async {
        guard held == nil else { return }
        await withCheckedContinuation { waitingForHeld.append($0) }
    }

    func release() async {
        await heldSend()
        held?.resume(returning: nil)
        held = nil
    }

    func fail(with error: AppError) async {
        await heldSend()
        held?.resume(returning: error)
        held = nil
    }

    func sendMessage(_ text: String) async throws(AppError) -> Run {
        let run = try await backend.sendMessage(text)
        let failure = await withCheckedContinuation { continuation in
            held = continuation
            for waiting in waitingForHeld { waiting.resume() }
            waitingForHeld = []
        }
        if let failure { throw failure }
        return run
    }

    func tasks() async throws(AppError) -> [ScheduledTask] { try await backend.tasks() }
    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask { try await backend.addTask(task) }
    func removeTask(id: String) async throws(AppError) { try await backend.removeTask(id: id) }
    func recentRuns(limit: Int) async throws(AppError) -> [Run] { try await backend.recentRuns(limit: limit) }
}
