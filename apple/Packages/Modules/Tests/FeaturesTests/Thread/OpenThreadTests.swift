import Backend
import Foundation
import Synchronization
import Testing

@testable import Features

struct OpenThreadTests {
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
        let thread = OpenThread(backend: FakeThreadBackend())
        await thread.load()
        thread.draft = "請求書の件、返信の下書きを作って。"

        await thread.send()?.value

        let latest = try #require(thread.runs?.first)
        #expect(latest.postId == "post-3")
        #expect(
            thread.entries.value?.dropFirst().first
                == .post(
                    .init(
                        id: "post-3", agentId: nil, text: "請求書の件、返信の下書きを作って。", attachments: [],
                        createdAt: Samples.moment("2026-11-10T09:00:00Z")))
        )
        #expect(thread.runs?.count == 5)
        #expect(thread.draft.isEmpty)
    }

    @Test func sendsNothingForAFieldWithOnlySpaces() async {
        let thread = OpenThread(backend: FakeThreadBackend())
        await thread.load()
        thread.draft = "  \n"

        #expect(thread.send() == nil)
        #expect(thread.runs?.count == 4)
    }

    @Test func aMessageThatDoesNotGoThroughGoesBackToTheFieldAndSaysWhy() async {
        let backend = FakeThreadBackend()
        let thread = OpenThread(backend: backend)
        await thread.load()
        backend.answer { $0.failure = .refused(message: "Something went wrong") }
        thread.draft = "こんにちは"

        await thread.send()?.value

        #expect(thread.draft == "こんにちは")
        #expect(thread.sendProblem == .refused(message: "Something went wrong"))
        #expect(thread.isShowingSendProblem)
        #expect(thread.runs?.count == 4)
    }

    @Test func aMessageThatDoesNotGoThroughGoesBeforeWhatWasWrittenSince() async {
        let backend = HeldSends(FakeThreadBackend())
        let thread = OpenThread(backend: backend)
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
        let backend = HeldSends(FakeThreadBackend())
        let thread = OpenThread(backend: backend)
        await thread.load()
        thread.draft = "こんにちは"

        let sending = thread.send()
        await backend.heldSend()
        await thread.load()
        await backend.release()
        await sending?.value

        let ids = thread.runs?.map(\.id) ?? []
        #expect(ids.count == 5)
        #expect(Set(ids).count == ids.count)
    }

    @Test func aMessageTheServerRefusesTheSignInForOffersToSignInAgain() async {
        let backend = FakeThreadBackend()
        let thread = OpenThread(backend: backend)
        await thread.load()
        backend.answer { $0.failure = .signedOut }
        thread.draft = "こんにちは"

        await thread.send()?.value

        #expect(thread.entries.failure == .signedOut)
        #expect(thread.sendProblem == nil)
    }

    @Test func aRunHeardTakesItsPlaceAndItsProgressIsOver() async {
        let thread = OpenThread(backend: FakeThreadBackend(.init(runs: [Samples.sentRun, Samples.mailRun])))
        await thread.load()

        thread.hear(Samples.progress(Samples.thinking, of: Samples.sentRun))
        let whileThinking = thread.progress[Samples.sentRun.id]
        thread.hear(Samples.changed(answered))

        #expect(whileThinking == Samples.thinking)
        #expect(thread.runs?.first?.endedAt == answered.endedAt)
        #expect(thread.progress.isEmpty)
    }

    @Test func aNewRunHeardGoesInByWhenItStarted() async {
        let thread = OpenThread(backend: FakeThreadBackend(.init(runs: [Samples.sentRun, Samples.weatherRun])))
        await thread.load()

        thread.hear(Samples.changed(Samples.mailRun))

        #expect(thread.runs?.map(\.id) == [Samples.sentRun.id, Samples.mailRun.id, Samples.weatherRun.id])
    }

    @Test func aPostHeardGoesInBeforeTheRunsThatReplyToIt() async {
        let thread = OpenThread(backend: FakeThreadBackend(.init(runs: [], posts: [])))
        await thread.load()

        thread.hear(Samples.changed(Samples.sentRun))
        thread.hear(Samples.posted(Samples.sentPost))
        thread.hear(Samples.posted(Samples.mailPost))
        thread.hear(Samples.changed(Samples.mailRun))

        #expect(
            thread.entries.value?.map(\.id) == [
                "run-\(Samples.sentRun.id)", "post-\(Samples.sentPost.id)", "run-\(Samples.mailRun.id)",
                "post-\(Samples.mailPost.id)",
            ])
    }

    @Test func repliesAtTheOldestEndWhosePostDidNotFitAreLeftOut() async {
        let thread = OpenThread(
            backend: FakeThreadBackend(.init(runs: [Samples.sentRun, Samples.mailRun], posts: [Samples.sentPost])))

        await thread.load()

        #expect(thread.entries.value?.map(\.id) == ["run-\(Samples.sentRun.id)", "post-\(Samples.sentPost.id)"])
    }

    @Test func repliesToOnePostGoInTheServersOrderHoweverTheyCome() async {
        let replies = ["b", "a", "c"].map { id in
            var run = Samples.sentRun
            run.id = id
            return run
        }
        let thread = OpenThread(backend: FakeThreadBackend(.init(runs: [], posts: [Samples.sentPost])))
        await thread.load()

        for run in replies { thread.hear(Samples.changed(run)) }

        #expect(thread.runs?.map(\.id) == ["c", "b", "a"])
    }

    @Test func sendingToAGroupPutsThePostAndEveryReplyInTheThread() async {
        let thread = OpenThread(backend: FakeThreadBackend(.init(runs: [], posts: [], repliers: ["mail", "stocks"])))
        await thread.load()
        thread.draft = "今日の予定は？"

        await thread.send()?.value

        #expect(thread.runs?.map(\.agentId).sorted() == ["mail", "stocks"])
        #expect(
            thread.entries.value?.last
                == .post(
                    .init(
                        id: "post-1", agentId: nil, text: "今日の予定は？", attachments: [],
                        createdAt: Samples.moment("2026-11-10T09:00:00Z"))))
    }

    @Test func theAnswerToASendKeepsWhatTheSocketSaidFirst() async {
        let backend = HeldSends(FakeThreadBackend(.init(runs: [Samples.mailRun])))
        let thread = OpenThread(backend: backend)
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

        #expect(thread.runs?.first?.lastError == "The model did not answer in time.")
        #expect(thread.progress[started.id] == Samples.thinking)
    }

    @Test func progressHeardAfterARunDuringAReadStaysWhenTheReadLands() async {
        let backend = HeldEntryReads(FakeThreadBackend(.init(runs: [Samples.sentRun])))
        let thread = OpenThread(backend: backend)
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
        let backend = HeldEntryReads(FakeThreadBackend(.init(runs: [Samples.sentRun])))
        let thread = OpenThread(backend: backend)
        let firstRead = Task { await thread.load() }
        await backend.release()
        await firstRead.value

        let read = Task { await thread.load() }
        await backend.heldRead()
        thread.hear(Samples.changed(answered))
        await backend.release()
        await read.value

        #expect(thread.runs?.first?.endedAt == answered.endedAt)
    }

    @Test func followingReadsTheRunsOnceTheSocketIsOpenAndHearsWhatItSays() async {
        let backend = FakeThreadBackend(.init(runs: [Samples.sentRun]))
        let thread = OpenThread(backend: backend)

        let following = Task { await thread.follow() }
        await eventually { thread.entries.value != nil }
        backend.hear(Samples.progress(Samples.writing("下書き"), of: Samples.sentRun))
        await eventually { thread.progress[Samples.sentRun.id] != nil }
        following.cancel()
        await following.value

        #expect(thread.runs?.map(\.id) == [Samples.sentRun.id])
        #expect(thread.progress[Samples.sentRun.id] == Samples.writing("下書き"))
    }

    @Test func opensTheSocketAgainSoonAfterOneThatStayedOpenAndLaterAfterOneThatClosedAtOnce() async {
        let backend = FakeThreadBackend(.init(runs: [Samples.sentRun]))
        let waits = Mutex<[Duration]>([])
        var clock = ContinuousClock.now
        let thread = OpenThread(
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
        let backend = FakeThreadBackend(.init(failure: .offline))
        let waits = Mutex<[Duration]>([])
        let thread = OpenThread(backend: backend) { delay in
            let count = waits.withLock {
                $0.append(delay)
                return $0.count
            }
            if count == 3 { backend.answer { $0.failure = .signedOut } }
        }

        await thread.follow()

        #expect(waits.withLock { $0 } == [.seconds(2), .seconds(4), .seconds(8)])
        #expect(thread.entries.failure == .signedOut)
    }

    @Test func aRunSentWhileAReadIsOnItsWayStaysAfterTheReadLands() async {
        let backend = HeldEntryReads(FakeThreadBackend())
        let thread = OpenThread(backend: backend)
        let firstRead = Task { await thread.load() }
        await backend.release()
        await firstRead.value

        let staleRead = Task { await thread.load() }
        await backend.heldRead()
        thread.draft = "こんにちは"
        await thread.send()?.value
        await backend.release()
        await staleRead.value

        #expect(thread.runs?.count == 5)
    }
}

/// Holds every post sent once the server has started its runs, as the server does before it answers, until the test
/// lets the answer through or fails it.
private actor HeldSends: ThreadBackend {
    private let backend: FakeThreadBackend
    private var held: (run: Run, answer: CheckedContinuation<AppError?, Never>)?
    private var waitingForHeld: [CheckedContinuation<Run, Never>] = []

    init(_ backend: FakeThreadBackend) {
        self.backend = backend
    }

    /// Returns the first run the post being held started, once one is.
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

    func send(_ text: String) async throws(AppError) -> SentPost {
        let sent = try await backend.send(text)
        guard let run = sent.runs.first else { return sent }
        let failure = await withCheckedContinuation { continuation in
            held = (run, continuation)
            for waiting in waitingForHeld { waiting.resume(returning: run) }
            waitingForHeld = []
        }
        if let failure { throw failure }
        return sent
    }

    func entries(limit: Int) async throws(AppError) -> [ThreadEntry] { try await backend.entries(limit: limit) }

    func followEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        try await backend.followEvents(onOpen: onOpen, onEvent: onEvent)
    }
}

extension OpenThread {
    /// The runs among the thread's entries, latest first, once it is read.
    var runs: [Run]? {
        entries.value?.compactMap(\.run)
    }
}
