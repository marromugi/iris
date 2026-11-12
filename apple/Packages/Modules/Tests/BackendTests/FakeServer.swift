import AuthenticationServices
import Foundation
import Synchronization

@testable import Backend

/// Stands in for the iris server: registers the app, issues, refreshes, and revokes the tokens of one grant, and
/// answers `/api` for the access token it last issued, for a user with one agent, keeping the tasks it was given.
/// Records every request.
actor FakeServer {
    /// The user's one agent.
    static let agentID = "5d7c9e1a-2b4f-4c6d-8e0a-1b3c5d7e9f20"

    private struct Grant {
        let clientID: String
        var accessToken: String?
        let refreshToken: String
        /// Still good for a revocation, as on the real server.
        let previousRefreshToken: String?
    }

    let origin = URL(string: "https://iris.test")!
    private(set) var requests: [URLRequest] = []
    private var registeredClients: Set<String> = []
    private var registrations = 0
    private var issued = 0
    private var grant: Grant?
    private var authorizedClient: String?
    private var challenge: String?
    private var refusesEveryToken = false
    private var namesNoUser = false
    private var missesRevocations = false
    private var holdsRefreshAnswers = false
    /// The time zone the app last set, nil until it sets one.
    private(set) var timeZone: String?
    /// The mail address the user has, as `/api/me/mail` names it; nil until one is made.
    private(set) var mailAddress: String?
    /// How many times the app let go of Gmail's confirmation.
    private(set) var confirmationsDismissed = 0
    /// Whether the agent is active, as deactivating and activating left it.
    private var agentActive = true
    private var heldRefreshAnswers: [CheckedContinuation<Void, Never>] = []
    private var waitingForHeldRefresh: [CheckedContinuation<Void, Never>] = []
    private var tasks: [String] = [
        #"{"id":"0b4f6a52-9a51-4c7e-8a9e-6d1f2c3b4a50","prompt":"天気を教えて","schedule":{"cron":"0 7 * * *","timeZone":"Asia/Tokyo"},"nextRunAt":"2026-11-10T22:00:00Z"}"#
    ]

    /// Forgets the access token it issued, as after it expired early on the server.
    func revokeAccessToken() { grant?.accessToken = nil }
    /// Ends the grant, so neither of its tokens works any more.
    func endGrant() { grant = nil }
    /// Forgets every registered app, as when registrations expire.
    func forgetRegistrations() { registeredClients = [] }
    /// Refuses every access token with 401, even a fresh one.
    func refuseEveryToken() { refusesEveryToken = true }
    /// Answers `/api` with 403, as for a token whose grant names no user.
    func nameNoUser() { namesNoUser = true }
    /// Never hears of a revocation, as when the connection drops on the way.
    func missRevocations() { missesRevocations = true }

    /// Keeps refresh answers back, after the refresh is done on the server, until `releaseRefreshAnswers()`.
    func holdRefreshAnswers() { holdsRefreshAnswers = true }

    /// Returns once a refresh answer is being held.
    func heldRefreshAnswer() async {
        guard heldRefreshAnswers.isEmpty else { return }
        await withCheckedContinuation { waitingForHeldRefresh.append($0) }
    }

    func releaseRefreshAnswers() {
        holdsRefreshAnswers = false
        for continuation in heldRefreshAnswers { continuation.resume() }
        heldRefreshAnswers = []
    }

    nonisolated var send: Send {
        { request in try await self.handle(request) }
    }

    nonisolated var openSocket: OpenSocket {
        { request in FakeSocket(server: self, request: request) }
    }

    /// How an open events socket behaves: what it sends, and then whether it stays open and answers pings.
    fileprivate struct SocketScript: Sendable {
        var messages: [String] = []
        /// Stays open after its messages until the app closes it, instead of being closed by the server.
        var staysOpen = false
        var answersPings = true
    }

    private var socketScript = SocketScript()
    private var dropsSockets = false

    /// Sends these on each events socket once it is open, before the server closes it.
    func sendOnEvents(_ messages: [String]) { socketScript.messages = messages }
    /// Keeps each events socket open after its messages, and leaves its pings unanswered, as a dead connection does.
    func goSilentOnSockets() {
        socketScript.staysOpen = true
        socketScript.answersPings = false
    }
    /// Can't be reached for a socket, as when offline.
    func dropSockets() { dropsSockets = true }

    /// Answers the upgrade as the real server does: 401 for a token it did not issue last, 403 for one naming no user,
    /// and 404 for an agent the user does not have; otherwise how the socket behaves.
    fileprivate func openEvents(_ request: URLRequest) -> Result<SocketScript, SocketRefusal> {
        requests.append(request)
        if dropsSockets { return .failure(SocketRefusal(status: nil, failure: .offline)) }
        let authorization = request.value(forHTTPHeaderField: "Authorization")
        guard !refusesEveryToken, let accessToken = grant?.accessToken, authorization == "Bearer \(accessToken)" else {
            return .failure(SocketRefusal(status: 401, failure: .unexpected))
        }
        if namesNoUser { return .failure(SocketRefusal(status: 403, failure: .unexpected)) }
        guard ["/api/threads/\(Self.agentID)/events", "/api/me/events"].contains(request.url?.path) else {
            return .failure(SocketRefusal(status: 404, failure: .unexpected))
        }
        return .success(socketScript)
    }

    /// What the sign-in sheet would come back with for `url`: the page's code for the state it was sent. For an app the
    /// server does not know, the page can only show an error, and the user closes the sheet.
    func signInSheet(url: URL) throws -> URL {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        guard let clientID = value("client_id"), registeredClients.contains(clientID) else {
            throw ASWebAuthenticationSessionError(.canceledLogin)
        }
        authorizedClient = clientID
        challenge = value("code_challenge")
        return URL(string: "dev.marromugi.iris:/oauth?code=the-code&state=\(value("state") ?? "")")!
    }

    private func handle(_ request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let path = request.url?.path ?? ""
        let form = Self.form(request.httpBody)
        switch path {
        case "/register":
            registrations += 1
            registeredClients.insert("client-\(registrations)")
            return Self.answer(request, 201, #"{"client_id":"client-\#(registrations)"}"#)
        case "/token" where form["grant_type"] == "authorization_code":
            guard form["code"] == "the-code", let clientID = form["client_id"], clientID == authorizedClient,
                let verifier = form["code_verifier"], PKCE(verifier: verifier).challenge == challenge
            else { return Self.answer(request, 400, #"{"error":"invalid_grant"}"#) }
            return Self.answer(request, 200, issue(to: clientID, replacing: nil))
        case "/token" where form["grant_type"] == "refresh_token":
            guard let grant, form["client_id"] == grant.clientID, form["refresh_token"] == grant.refreshToken else {
                return Self.answer(request, 400, #"{"error":"invalid_grant"}"#)
            }
            let answer = Self.answer(request, 200, issue(to: grant.clientID, replacing: grant.refreshToken))
            if holdsRefreshAnswers {
                await withCheckedContinuation { continuation in
                    heldRefreshAnswers.append(continuation)
                    for continuation in waitingForHeldRefresh { continuation.resume() }
                    waitingForHeldRefresh = []
                }
            }
            return answer
        case "/token" where form["token"] != nil:
            if missesRevocations { throw URLError(.networkConnectionLost) }
            if let grant, form["client_id"] == grant.clientID,
                form["token"] == grant.refreshToken || form["token"] == grant.previousRefreshToken
            {
                self.grant = nil
            }
            return Self.answer(request, 200, "")
        case _ where path.hasPrefix("/api/"):
            let authorization = request.value(forHTTPHeaderField: "Authorization")
            guard !refusesEveryToken, let accessToken = grant?.accessToken, authorization == "Bearer \(accessToken)" else {
                return Self.answer(request, 401, "")
            }
            if namesNoUser { return Self.answer(request, 403, #"{"message":"Forbidden"}"#) }
            return api(request, path: path)
        default:
            return Self.answer(request, 404, #"{"message":"Not found"}"#)
        }
    }

    /// `/api` as the real one answers it, for the requests the app sends.
    private var mailSetupJSON: String {
        let address = mailAddress.map { #""\#($0)""# } ?? "null"
        return #"{"address":\#(address),"confirmation":null,"lastMailAt":null}"#
    }

    private func api(_ request: URLRequest, path: String) -> (Data, URLResponse) {
        if request.httpMethod == "GET", path == "/api/agents" {
            return Self.answer(
                request, 200,
                #"[{"id":"\#(Self.agentID)","name":"エージェント","look":{"palette":3,"seed":42},"lastRanAt":"2026-11-09T22:00:00Z","active":\#(agentActive)}]"#)
        }
        if request.httpMethod == "PUT", path == "/api/me/time-zone" {
            struct Sent: Decodable { let timeZone: String }
            guard request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("application/json") == true,
                let body = request.httpBody, let sent = try? JSONDecoder().decode(Sent.self, from: body)
            else { return Self.answer(request, 415, #"{"message":"Unsupported Media Type"}"#) }
            guard TimeZone(identifier: sent.timeZone) != nil else {
                return Self.answer(request, 400, #"{"message":"✖ Not a known IANA time zone.\n  → at timeZone"}"#)
            }
            timeZone = sent.timeZone
            return Self.answer(request, 204, "")
        }
        switch (request.httpMethod, path) {
        case ("GET", "/api/me/mail"):
            return Self.answer(request, 200, mailSetupJSON)
        case ("POST", "/api/me/mail/address"):
            mailAddress = "iris+0123456789abcdef01234567@marromugi.me"
            return Self.answer(request, 200, mailSetupJSON)
        case ("DELETE", "/api/me/mail/address"):
            mailAddress = nil
            return Self.answer(request, 204, "")
        case ("DELETE", "/api/me/mail/confirmation"):
            confirmationsDismissed += 1
            return Self.answer(request, 204, "")
        default:
            break
        }
        // The agent's ID also names its one-to-one thread here.
        let threadPath = "/api/threads/\(Self.agentID)"
        if path.hasPrefix("\(threadPath)/") {
            return thread(request, rest: String(path.dropFirst(threadPath.count)))
        }
        let agentPath = "/api/agents/\(Self.agentID)"
        guard path.hasPrefix("\(agentPath)/") else {
            return Self.answer(request, 404, #"{"message":"No agent of this user has this ID"}"#)
        }
        let rest = String(path.dropFirst(agentPath.count))
        switch (request.httpMethod, rest) {
        case ("GET", "/tasks"):
            return Self.answer(request, 200, "[\(tasks.joined(separator: ","))]")
        case ("POST", "/tasks"):
            struct Sent: Decodable {
                struct Schedule: Decodable { let cron: String, timeZone: String }
                let prompt: String
                let schedule: Schedule
            }
            // The generated client sends "application/json; charset=utf-8", which Hono reads as JSON.
            guard request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("application/json") == true,
                let body = request.httpBody, let sent = try? JSONDecoder().decode(Sent.self, from: body)
            else { return Self.answer(request, 415, #"{"message":"Unsupported Media Type"}"#) }
            guard sent.schedule.timeZone == "Asia/Tokyo" else {
                return Self.answer(
                    request, 400, #"{"message":"✖ Not a known IANA time zone.\n  → at schedule.timeZone"}"#)
            }
            let task =
                #"{"id":"3c9d1e7a-5b2f-4e8c-9a1d-7f6e5d4c3b2a","prompt":"\#(sent.prompt)","schedule":{"cron":"\#(sent.schedule.cron)","timeZone":"\#(sent.schedule.timeZone)"},"nextRunAt":"2026-11-10T21:30:00Z"}"#
            tasks.append(task)
            return Self.answer(request, 201, task)
        case ("POST", "/deactivate"):
            agentActive = false
            return Self.answer(request, 204, "")
        case ("POST", "/activate"):
            agentActive = true
            return Self.answer(request, 204, "")
        case ("DELETE", _) where rest.hasPrefix("/tasks/"):
            let id = String(rest.dropFirst("/tasks/".count))
            guard let index = tasks.firstIndex(where: { $0.contains(#""id":"\#(id)""#) }) else {
                return Self.answer(request, 404, #"{"message":"No task of this agent has this ID"}"#)
            }
            tasks.remove(at: index)
            return Self.answer(request, 204, "")
        default:
            return Self.answer(request, 404, #"{"message":"Not found"}"#)
        }
    }

    /// The agent's one-to-one thread, as `/api/threads/{threadId}` answers.
    private func thread(_ request: URLRequest, rest: String) -> (Data, URLResponse) {
        switch (request.httpMethod, rest) {
        case ("POST", "/posts"):
            struct Sent: Decodable { let text: String }
            guard request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("application/json") == true,
                let body = request.httpBody, let sent = try? JSONDecoder().decode(Sent.self, from: body)
            else { return Self.answer(request, 415, #"{"message":"Unsupported Media Type"}"#) }
            guard !sent.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return Self.answer(
                    request, 400, #"{"message":"✖ Too small: expected string to have >=1 characters\n  → at text"}"#)
            }
            return Self.answer(
                request, 202,
                #"{"post":{"id":"5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d","agentId":null,"text":"\#(sent.text)","attachments":[],"createdAt":"2026-11-10T09:00:00Z"},"runs":[{"id":"6b1d3f5a-7c9e-4b2d-8f0a-3c5e7a9b1d2f","agentId":"1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e","taskId":null,"postId":"5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d","startedAt":"2026-11-10T09:00:00Z","endedAt":null,"lastError":null,"failedAttempts":0,"consults":[],"messages":[{"role":"user","text":"\#(sent.text)"}]}]}"#
            )
        case ("GET", "/entries"):
            return Self.answer(
                request, 200,
                #"[{"type":"run","run":{"id":"8e2a4c6b-1d3f-4a5b-9c7d-2e4f6a8b0c1d","agentId":"1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e","taskId":null,"postId":"7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918","startedAt":"2026-11-09T22:00:00Z","endedAt":"2026-11-09T22:00:07Z","lastError":null,"failedAttempts":0,"consults":[],"messages":[{"role":"user","text":"天気を教えて"},{"role":"assistant","parts":[{"type":"tool-call","id":"call-1","name":"weather","input":{"city":"Tokyo"}}]},{"role":"tool","callId":"call-1","isError":false,"content":"雨"},{"role":"assistant","parts":[{"type":"text","text":"傘を持っていきましょう。"}]}]}},{"type":"post","post":{"id":"7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918","agentId":null,"text":"天気を教えて","attachments":[],"createdAt":"2026-11-09T22:00:00Z"}}]"#
            )
        default:
            return Self.answer(request, 404, #"{"message":"Not found"}"#)
        }
    }

    private func issue(to clientID: String, replacing previousRefreshToken: String?) -> String {
        issued += 1
        grant = Grant(
            clientID: clientID, accessToken: "access-\(issued)", refreshToken: "refresh-\(issued)",
            previousRefreshToken: previousRefreshToken)
        return
            #"{"access_token":"access-\#(issued)","refresh_token":"refresh-\#(issued)","expires_in":3600,"token_type":"bearer"}"#
    }

    private static func answer(_ request: URLRequest, _ status: Int, _ body: String) -> (Data, URLResponse) {
        let headers = body.isEmpty ? [:] : ["Content-Type": "application/json"]
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (Data(body.utf8), response)
    }

    private static func form(_ body: Data?) -> [String: String] {
        guard let body, let text = String(data: body, encoding: .utf8) else { return [:] }
        var form: [String: String] = [:]
        for pair in text.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? String($0) }
            if parts.count == 2 { form[parts[0]] = parts[1] }
        }
        return form
    }
}

/// The events socket the fake server opens: refused as the server answers, or the messages it holds, one per read, and
/// then closed or held open as the server's script says.
private final class FakeSocket: EventSocket {
    private struct State {
        var script = FakeServer.SocketScript()
        var closed = false
        var waiting: [CheckedContinuation<Void, Never>] = []
    }

    private let server: FakeServer
    private let request: URLRequest
    private let state = Mutex(State())

    init(server: FakeServer, request: URLRequest) {
        self.server = server
        self.request = request
    }

    func open() async throws(SocketRefusal) {
        switch await server.openEvents(request) {
        case .success(let script): state.withLock { $0.script = script }
        case .failure(let refusal): throw refusal
        }
    }

    func receive() async throws -> String? {
        let (message, staysOpen) = state.withLock { state in
            state.script.messages.isEmpty
                ? (nil, state.script.staysOpen) : (state.script.messages.removeFirst(), false)
        }
        if let message { return message }
        if staysOpen { await untilClosed() }
        return nil
    }

    func ping() async throws {
        guard !state.withLock({ $0.script.answersPings }) else { return }
        await untilClosed()
        throw URLError(.cancelled)
    }

    func close() {
        let waiting = state.withLock { state in
            state.closed = true
            defer { state.waiting = [] }
            return state.waiting
        }
        for continuation in waiting { continuation.resume() }
    }

    private func untilClosed() async {
        await withCheckedContinuation { continuation in
            let closed = state.withLock { state in
                if !state.closed { state.waiting.append(continuation) }
                return state.closed
            }
            if closed { continuation.resume() }
        }
    }
}
