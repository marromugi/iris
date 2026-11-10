import Foundation
import OSLog

private let log = Logger(subsystem: "dev.marromugi.iris", category: "backend")

extension IrisBackend {
    /// Follows the agent's events: opens its socket with the user's token, calls `onOpen` once it is open, then
    /// `onEvent` for each event, and returns when the socket closes. Cancelling the task closes it, even while it is
    /// opening. While it is open, the server is pinged every `socketPings.every`; a socket whose ping goes unanswered
    /// for `socketPings.answerWithin` is taken for dead and closed, as a connection can die without a word.
    ///
    /// A refused token is refreshed once and the socket opened again; when that is refused too, or the token names no
    /// user, the sign-in ends and this throws `.signedOut`, as every call does. A socket that can't be reached throws
    /// `.offline`; an answer or event the app does not expect, `.unexpected`.
    public func followEvents(
        of agentID: Agent.ID,
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (RunEvent) async -> Void
    ) async throws(AppError) {
        let socket = try await openEvents(of: agentID)
        defer { socket.close() }
        if Task.isCancelled { throw .cancelled }
        await onOpen()
        let pings = socketPings
        do {
            try await withTaskCancellationHandler {
                try await withThrowingTaskGroup(of: Void.self) { group in
                    group.addTask { await Self.closeWhenPingsGoUnanswered(socket, pings: pings) }
                    while let text = try await socket.receive() {
                        await onEvent(try Self.event(from: text))
                    }
                    group.cancelAll()
                }
            } onCancel: {
                socket.close()
            }
        } catch {
            throw AppError(error)
        }
    }

    private static func closeWhenPingsGoUnanswered(_ socket: any EventSocket, pings: SocketPings) async {
        while true {
            do {
                try await Task.sleep(for: pings.every)
            } catch {
                return
            }
            let answered = await withTaskGroup(of: Bool.self) { group in
                group.addTask { (try? await socket.ping()) != nil }
                group.addTask {
                    try? await Task.sleep(for: pings.answerWithin)
                    return false
                }
                let first = await group.next() ?? false
                // A ping still waiting ends once the socket is closed.
                if !first { socket.close() }
                group.cancelAll()
                return first
            }
            if !answered { return }
        }
    }

    private func openEvents(of agentID: Agent.ID) async throws(AppError) -> any EventSocket {
        var token = try await vault.accessToken()
        var refreshed = false
        while true {
            let socket = openSocket(try eventsRequest(of: agentID, token: token))
            do throws(SocketRefusal) {
                try await socket.open()
                return socket
            } catch {
                switch error.status {
                case 401 where !refreshed:
                    refreshed = true
                    token = try await vault.refreshedAccessToken(replacing: token)
                case 401, 403:
                    await vault.endSignIn(refusing: token)
                    throw .signedOut
                case nil:
                    throw error.failure
                case let status?:
                    log.error("The server answered the events socket with \(status)")
                    throw .unexpected
                }
            }
        }
    }

    private func eventsRequest(of agentID: Agent.ID, token: String) throws(AppError) -> URLRequest {
        guard var url = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { throw .unexpected }
        url.scheme = url.scheme == "http" ? "ws" : "wss"
        url.path = "/api/agents/\(agentID)/events"
        guard let socketURL = url.url else { throw .unexpected }
        var request = URLRequest(url: socketURL)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private static func event(from text: String) throws(AppError) -> RunEvent {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            return try decoder.decode(RunEvent.self, from: Data(text.utf8))
        } catch {
            log.error("An event the app can't read: \(String(describing: error))")
            throw .unexpected
        }
    }
}
