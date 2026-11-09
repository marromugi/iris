import AuthenticationServices
import Foundation

@testable import Backend

/// Stands in for the iris server: registers the app, issues, refreshes, and revokes the tokens of one grant, and
/// answers `/api` for the access token it last issued, keeping the tasks it was given. Records every request.
actor FakeServer {
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
    private func api(_ request: URLRequest, path: String) -> (Data, URLResponse) {
        switch (request.httpMethod, path) {
        case ("GET", "/api/tasks"):
            return Self.answer(request, 200, "[\(tasks.joined(separator: ","))]")
        case ("POST", "/api/tasks"):
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
        case ("DELETE", _) where path.hasPrefix("/api/tasks/"):
            let id = String(path.dropFirst("/api/tasks/".count))
            guard let index = tasks.firstIndex(where: { $0.contains(#""id":"\#(id)""#) }) else {
                return Self.answer(request, 404, #"{"message":"No task of this user has this ID"}"#)
            }
            tasks.remove(at: index)
            return Self.answer(request, 204, "")
        case ("GET", "/api/runs"):
            return Self.answer(
                request, 200,
                #"[{"id":"8e2a4c6b-1d3f-4a5b-9c7d-2e4f6a8b0c1d","taskId":null,"startedAt":"2026-11-09T22:00:00Z","endedAt":"2026-11-09T22:00:07Z","lastError":null,"failedAttempts":0,"messages":[{"role":"user","text":"天気を教えて"},{"role":"assistant","parts":[{"type":"tool-call","id":"call-1","name":"weather","input":{"city":"Tokyo"}}]},{"role":"tool","callId":"call-1","isError":false,"content":"雨"},{"role":"assistant","parts":[{"type":"text","text":"傘を持っていきましょう。"}]}]}]"#
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
