import Backend
import Foundation
import Synchronization
import Testing

@testable import Features

struct AgentThreadTests {
    /// The sent message's run, once the agent replied.
    let answered = {
        var run = Samples.sentRun
        run.endedAt = Samples.moment("2026-11-10T00:05:09Z")
        return run
    }()

    /// Returns once `condition` holds, giving up after a second.
    func eventually(_ condition: () -> Bool) async {
        for _ in 0..<200 where !condition() {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

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

    @Test func aRunHeardTakesItsPlaceAndItsProgressIsOver() async {
        let thread = AgentThread(backend: FakeAgentBackend(.init(runs: [Samples.sentRun, Samples.mailRun])))
        await thread.load()

        thread.hear(Samples.progress(Samples.thinking, of: Samples.sentRun))
        let whileThinking = thread.progress[Samples.sentRun.id]
        thread.hear(Samples.changed(answered))

        #expect(whileThinking == Samples.thinking)
        #expect(thread.runs.value?.first?.endedAt == answered.endedAt)
        #expect(thread.progress.isEmpty)
    }

    @Test func aNewRunHeardGoesInByWhenItStarted() async {
        let thread = AgentThread(backend: FakeAgentBackend(.init(runs: [Samples.sentRun, Samples.weatherRun])))
        await thread.load()

        thread.hear(Samples.changed(Samples.mailRun))

        #expect(thread.runs.value?.map(\.id) == [Samples.sentRun.id, Samples.mailRun.id, Samples.weatherRun.id])
    }

    @Test func theAnswerToASendKeepsWhatTheSocketSaidFirst() async {
        let backend = HeldSends(FakeAgentBackend(.init(runs: [Samples.mailRun])))
        let thread = AgentThread(backend: backend)
        await thread.load()
        thread.draft = "こんにちは"

        let sending = thread.send()
        let started = await backend.heldSend()
        let failedOnce = {
            var run = started
            run.lastError = "The model did not answer in time."
            run.failedAttempts = 1
            return run
        }()
        thread.hear(Samples.changed(failedOnce))
        thread.hear(Samples.progress(Samples.thinking, of: started))
        await backend.release()
        await sending?.value

        #expect(thread.runs.value?.first?.lastError == "The model did not answer in time.")
        #expect(thread.progress[started.id] == Samples.thinking)
    }

    @Test func progressHeardAfterARunDuringAReadStaysWhenTheReadLands() async {
        let backend = HeldReads(FakeAgentBackend(.init(runs: [Samples.sentRun])))
        let thread = AgentThread(backend: backend)
        let firstRead = Task { await thread.load() }
        await backend.release()
        await firstRead.value

        let read = Task { await thread.load() }
        await backend.heldRead()
        thread.hear(Samples.changed(Samples.sentRun))
        thread.hear(Samples.progress(Samples.thinking, of: Samples.sentRun))
        await backend.release()
        await read.value

        #expect(thread.progress[Samples.sentRun.id] == Samples.thinking)
    }

    @Test func aRunHeardWhileAReadIsOnItsWayStaysAsItCame() async {
        let backend = HeldReads(FakeAgentBackend(.init(runs: [Samples.sentRun])))
        let thread = AgentThread(backend: backend)
        let firstRead = Task { await thread.load() }
        await backend.release()
        await firstRead.value

        let read = Task { await thread.load() }
        await backend.heldRead()
        thread.hear(Samples.changed(answered))
        await backend.release()
        await read.value

        #expect(thread.runs.value?.first?.endedAt == answered.endedAt)
    }

    @Test func followingReadsTheRunsOnceTheSocketIsOpenAndHearsWhatItSays() async {
        let backend = FakeAgentBackend(.init(runs: [Samples.sentRun]))
        let thread = AgentThread(backend: backend)

        let following = Task { await thread.follow() }
        await eventually { thread.runs.value != nil }
        backend.hear(Samples.progress(Samples.writing("下書き"), of: Samples.sentRun))
        await eventually { thread.progress[Samples.sentRun.id] != nil }
        following.cancel()
        await following.value

        #expect(thread.runs.value?.map(\.id) == [Samples.sentRun.id])
        #expect(thread.progress[Samples.sentRun.id] == Samples.writing("下書き"))
    }

    @Test func opensTheSocketAgainSoonAfterOneThatStayedOpenAndLaterAfterOneThatClosedAtOnce() async {
        let backend = FakeAgentBackend(.init(runs: [Samples.sentRun]))
        let waits = Mutex<[Duration]>([])
        var clock = ContinuousClock.now
        let thread = AgentThread(
            backend: backend, wait: { delay in waits.withLock { $0.append(delay) } }, now: { clock })

        let following = Task { await thread.follow() }
        await eventually { backend.socketsOpened == 1 }
        backend.closeSocket()
        await eventually { backend.socketsOpened == 2 }
        backend.hear(Samples.progress(Samples.thinking, of: Samples.sentRun))
        await eventually { !thread.progress.isEmpty }
        clock += .seconds(60)
        backend.closeSocket()
        await eventually { backend.socketsOpened == 3 }
        following.cancel()
        await following.value

        #expect(waits.withLock { $0 } == [.seconds(2), .seconds(1)])
        #expect(thread.progress.isEmpty)
    }

    @Test func waitsLongerAfterEachFailureInARowAndStopsWhenTheSignInEnds() async {
        let backend = FakeAgentBackend(.init(failure: .offline))
        let waits = Mutex<[Duration]>([])
        let thread = AgentThread(backend: backend) { delay in
            let count = waits.withLock {
                $0.append(delay)
                return $0.count
            }
            if count == 3 { backend.answer { $0.failure = .signedOut } }
        }

        await thread.follow()

        #expect(waits.withLock { $0 } == [.seconds(2), .seconds(4), .seconds(8)])
        #expect(thread.runs.failure == .signedOut)
    }

    @Test func aRunSentWhileAReadIsOnItsWayStaysAfterTheReadLands() async {
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
    private var held: (run: Run, answer: CheckedContinuation<AppError?, Never>)?
    private var waitingForHeld: [CheckedContinuation<Run, Never>] = []

    init(_ backend: FakeAgentBackend) {
        self.backend = backend
    }

    /// Returns the run the message being held started, once one is.
    @discardableResult
    func heldSend() async -> Run {
        if let held { return held.run }
        return await withCheckedContinuation { waitingForHeld.append($0) }
    }

    func release() async {
        await heldSend()
        held?.answer.resume(returning: nil)
        held = nil
    }

    func fail(with error: AppError) async {
        await heldSend()
        held?.answer.resume(returning: error)
        held = nil
    }

    func sendMessage(_ text: String) async throws(AppError) -> Run {
        let run = try await backend.sendMessage(text)
        let failure = await withCheckedContinuation { continuation in
            held = (run, continuation)
            for waiting in waitingForHeld { waiting.resume(returning: run) }
            waitingForHeld = []
        }
        if let failure { throw failure }
        return run
    }

    func tasks() async throws(AppError) -> [ScheduledTask] { try await backend.tasks() }
    func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask { try await backend.addTask(task) }
    func removeTask(id: String) async throws(AppError) { try await backend.removeTask(id: id) }
    func recentRuns(limit: Int) async throws(AppError) -> [Run] { try await backend.recentRuns(limit: limit) }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(onOpen: onOpen, onEvent: onEvent)
    }
}
