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
