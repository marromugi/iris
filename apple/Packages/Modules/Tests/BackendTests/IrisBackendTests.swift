import AuthenticationServices
import Foundation
import Synchronization
import Testing

@testable import Backend

struct IrisBackendTests {
    let server = FakeServer()
    let store = InMemoryCredentialStore()
    let agent = FakeServer.agentID

    func backend(now: Date = Date()) -> IrisBackend {
        IrisBackend(origin: server.origin, store: store, send: server.send, openSocket: server.openSocket, now: { now })
    }

    func signIn(_ backend: IrisBackend) async throws {
        try await backend.signIn { url, _ in try await server.signInSheet(url: url) }
    }

    @Test func signsInThroughTheSheetAndReadsTheTasks() async throws {
        let backend = backend()

        try await signIn(backend)
        let tasks = try await backend.tasks(of: agent)

        #expect(tasks.map(\.prompt) == ["天気を教えて"])
        #expect(tasks.first?.nextRunAt == Date(timeIntervalSince1970: 1_794_348_000))
        #expect(await backend.isSignedIn)
        #expect(store.load()?.origin == "https://iris.test")
    }

    @Test func signsInAgainAfterTheServerDroppedTheAppsRegistration() async throws {
        let backend = backend()
        try await signIn(backend)
        await backend.signOut()
        await server.forgetRegistrations()

        try await signIn(backend)

        #expect(try await backend.tasks(of: agent).count == 1)
    }

    @Test func ignoresASignInKeptForAnotherServer() async throws {
        let tokens = Tokens(accessToken: "access-9", refreshToken: "refresh-9", expiresAt: .distantFuture)
        store.save(Credentials(origin: "https://localhost:8787", clientID: "client-9", tokens: tokens))

        #expect(await !backend().isSignedIn)
    }

    @Test func closingTheSheetIsACancelAndKeepsNothing() async throws {
        let backend = backend()

        await #expect(throws: AppError.cancelled) {
            try await backend.signIn { _, _ in throw ASWebAuthenticationSessionError(.canceledLogin) }
        }
        #expect(store.load() == nil)
    }

    @Test func signingOutEndsTheGrantOnTheServerToo() async throws {
        let signedInAt = Date(timeIntervalSince1970: 0)
        let backend = backend(now: signedInAt)
        try await signIn(backend)
        let kept = try #require(store.load())

        await backend.signOut()

        let expired = IrisBackend(
            origin: server.origin, store: InMemoryCredentialStore(kept), send: server.send,
            now: { signedInAt.addingTimeInterval(3600) })
        await #expect(throws: AppError.signedOut) { try await expired.tasks(of: agent) }
    }

    @Test func signingOutWhileARefreshIsAnsweredStaysSignedOutEvenIfTheServerMissesIt() async throws {
        let signedInAt = Date(timeIntervalSince1970: 0)
        try await signIn(backend(now: signedInAt))
        let later = backend(now: signedInAt.addingTimeInterval(3600))
        await server.missRevocations()
        await server.holdRefreshAnswers()

        let read = Task { try await later.tasks(of: agent) }
        await server.heldRefreshAnswer()
        await later.signOut()
        await server.releaseRefreshAnswers()

        await #expect(throws: AppError.signedOut) { try await read.value }
        #expect(await !later.isSignedIn)
        #expect(store.load() == nil)
    }

    @Test func refreshesAndRetriesOnceWhenTheServerRefusesTheToken() async throws {
        let backend = backend()
        try await signIn(backend)
        await server.revokeAccessToken()

        let tasks = try await backend.tasks(of: agent)

        #expect(tasks.count == 1)
        #expect(store.load()?.tokens.accessToken == "access-2")
    }

    @Test func refreshesBeforeAskingWhenTheTokenIsAboutToExpire() async throws {
        let signedInAt = Date(timeIntervalSince1970: 0)
        try await signIn(backend(now: signedInAt))

        _ = try await backend(now: signedInAt.addingTimeInterval(3600 - 30)).tasks(of: agent)

        let apiRequests = await server.requests.filter { $0.url?.path == "/api/agents/\(agent)/tasks" }
        #expect(apiRequests.map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer access-2"])
    }

    @Test func endsTheSignInWhenTheRefreshIsRefused() async throws {
        let backend = backend()
        try await signIn(backend)
        await server.endGrant()

        await #expect(throws: AppError.signedOut) { try await backend.tasks(of: agent) }
        #expect(await !backend.isSignedIn)
        #expect(store.load() == nil)
    }

    @Test func endsTheSignInWhenEvenAFreshTokenIsRefused() async throws {
        let backend = backend()
        try await signIn(backend)
        await server.refuseEveryToken()

        await #expect(throws: AppError.signedOut) { try await backend.tasks(of: agent) }
        #expect(await !backend.isSignedIn)
    }

    @Test func endsTheSignInWhenTheTokenNamesNoUser() async throws {
        let backend = backend()
        try await signIn(backend)
        await server.nameNoUser()

        await #expect(throws: AppError.signedOut) { try await backend.tasks(of: agent) }
        #expect(await !backend.isSignedIn)
        #expect(store.load() == nil)
    }

    @Test func refreshesOnceForRequestsThatNeedItAtTheSameTime() async throws {
        let signedInAt = Date(timeIntervalSince1970: 0)
        try await signIn(backend(now: signedInAt))
        let later = backend(now: signedInAt.addingTimeInterval(3600))

        async let first = later.tasks(of: agent)
        async let second = later.entries(of: agent, limit: 20)
        _ = try await (first, second)

        let refreshes = await server.requests.filter { $0.url?.path == "/token" }.count - 1
        #expect(refreshes == 1)
    }

    @Test func addsATaskAsJSONAndGetsItBackWithItsNextRun() async throws {
        let backend = backend()
        try await signIn(backend)

        let added = try await backend.addTask(
            NewTask(prompt: "ニュースをまとめて", schedule: .init(cron: "30 6 * * *", timeZone: "Asia/Tokyo")), to: agent)

        #expect(added.prompt == "ニュースをまとめて")
        #expect(added.schedule.cron == "30 6 * * *")
        #expect(added.nextRunAt == Date(timeIntervalSince1970: 1_794_346_200))
        #expect(try await backend.tasks(of: agent).map(\.prompt) == ["天気を教えて", "ニュースをまとめて"])
    }

    @Test func aTaskTheServerRefusesSaysWhyInTheServersWords() async throws {
        let backend = backend()
        try await signIn(backend)

        await #expect(throws: AppError.refused(message: "✖ Not a known IANA time zone.\n  → at schedule.timeZone")) {
            try await backend.addTask(
                NewTask(prompt: "天気", schedule: .init(cron: "0 7 * * *", timeZone: "Mars/Olympus")), to: agent)
        }
    }

    @Test func listsTheAgentsAndRefusesOneTheUserDoesNotHave() async throws {
        let backend = backend()
        try await signIn(backend)

        let agents = try await backend.agents()

        #expect(agents.map(\.id) == [agent])
        #expect(agents.first?.lastRanAt == Date(timeIntervalSince1970: 1_794_261_600))
        await #expect(throws: AppError.refused(message: "No agent of this user has this ID")) {
            try await backend.tasks(of: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e")
        }
    }

    @Test func removesATaskAndCountsOneAlreadyGoneAsRemoved() async throws {
        let backend = backend()
        try await signIn(backend)
        let id = try #require(try await backend.tasks(of: agent).first?.id)

        try await backend.removeTask(id: id, of: agent)
        try await backend.removeTask(id: id, of: agent)

        #expect(try await backend.tasks(of: agent).isEmpty)
    }

    @Test func readsAThreadsEntriesAsAskedWithTheRunsConversations() async throws {
        let backend = backend()
        try await signIn(backend)

        let entries = try await backend.entries(of: agent, limit: 2)

        guard case .case2(let ran) = entries.first, case .case1(let posted) = entries.last else {
            Issue.record("expected a run and then its post, got \(entries)")
            return
        }
        let run = ran.run
        #expect(run.endedAt == Date(timeIntervalSince1970: 1_794_261_607))
        #expect(run.postId == posted.post.id)
        guard case .case2(let assistant) = run.messages[1], case .case2(let call) = assistant.parts.first else {
            Issue.record("expected the assistant's tool call, got \(run.messages[1])")
            return
        }
        #expect(call.name == "weather")
        #expect(call.input?.value as? [String: String] == ["city": "Tokyo"])
        #expect(run.messages.count == 4)
        #expect(await server.requests.last { $0.url?.path == "/api/threads/\(agent)/entries" }?.url?.query == "limit=2")
    }

    @Test func sendsAPostAsJSONAndGetsBackThePostAndTheRunsItStarted() async throws {
        let backend = backend()
        try await signIn(backend)

        let sent = try await backend.sendPost("こんにちは", to: agent)

        #expect(sent.post.text == "こんにちは")
        #expect(sent.runs.map(\.postId) == [sent.post.id])
        #expect(sent.runs.first?.endedAt == nil)
        await #expect(throws: AppError.refused(message: "✖ Too small: expected string to have >=1 characters\n  → at text")) {
            try await backend.sendPost(" ", to: agent)
        }
    }

    @Test func followsAThreadsEventsOnItsSocketUntilTheServerClosesIt() async throws {
        let backend = backend()
        try await signIn(backend)
        await server.sendOnEvents([
            #"{"type":"run","run":{"id":"6b1d3f5a-7c9e-4b2d-8f0a-3c5e7a9b1d2f","agentId":"1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e","taskId":null,"postId":null,"startedAt":"2026-11-10T09:00:00Z","endedAt":null,"lastError":null,"failedAttempts":0,"consults":[],"messages":[{"role":"user","text":"こんにちは"}]}}"#,
            #"{"type":"progress","runId":"6b1d3f5a-7c9e-4b2d-8f0a-3c5e7a9b1d2f","progress":{"type":"writing","text":"こん"}}"#,
        ])
        let heard = Mutex<[String]>([])

        try await backend.followEvents(of: agent) {
            heard.withLock { $0.append("open") }
        } onEvent: { event in
            heard.withLock {
                switch event {
                case .case1(let changed): $0.append("run \(changed.run.id)")
                case .case2(let progress):
                    guard case .case3(let writing) = progress.progress else { return }
                    $0.append("writing \(writing.text)")
                case .case3(let posted): $0.append("post \(posted.post.id)")
                }
            }
        }

        #expect(
            heard.withLock { $0 } == ["open", "run 6b1d3f5a-7c9e-4b2d-8f0a-3c5e7a9b1d2f", "writing こん"])
        let opened = try #require(await server.requests.last)
        #expect(opened.url?.absoluteString == "wss://iris.test/api/threads/\(agent)/events")
        #expect(opened.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    }

    @Test func opensTheSocketAgainWithARefreshedTokenAndSignsOutWhenThatIsRefusedToo() async throws {
        let backend = backend()
        try await signIn(backend)
        await server.revokeAccessToken()

        try await backend.followEvents(of: agent, onOpen: {}, onEvent: { _ in })
        await server.refuseEveryToken()

        let tokens = await server.requests.filter { $0.url?.path.hasSuffix("/events") == true }
            .map { $0.value(forHTTPHeaderField: "Authorization") }
        #expect(tokens == ["Bearer access-1", "Bearer access-2"])
        await #expect(throws: AppError.signedOut) {
            try await backend.followEvents(of: agent, onOpen: {}, onEvent: { _ in })
        }
        #expect(await !backend.isSignedIn)
    }

    @Test func aSocketThatCantBeReachedIsOfflineAndOneForAnotherAgentUnexpected() async throws {
        let backend = backend()
        try await signIn(backend)

        await #expect(throws: AppError.unexpected) {
            try await backend.followEvents(of: "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e", onOpen: {}, onEvent: { _ in })
        }
        await server.dropSockets()
        await #expect(throws: AppError.offline) {
            try await backend.followEvents(of: agent, onOpen: {}, onEvent: { _ in })
        }
        #expect(await backend.isSignedIn)
    }

    @Test func closesASocketWhosePingGoesUnanswered() async throws {
        let backend = IrisBackend(
            origin: server.origin, store: store, send: server.send, openSocket: server.openSocket,
            socketPings: SocketPings(every: .milliseconds(10), answerWithin: .milliseconds(10)))
        try await signIn(backend)
        await server.goSilentOnSockets()

        try await backend.followEvents(of: agent, onOpen: {}, onEvent: { _ in })
    }

    @Test func aCallWithoutASignInIsSignedOut() async throws {
        await #expect(throws: AppError.signedOut) { try await backend().tasks(of: agent) }
        #expect(await server.requests.isEmpty)
    }
}
