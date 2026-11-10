import Foundation
import OSLog

private let log = Logger(subsystem: "dev.marromugi.iris", category: "backend")

extension IrisBackend {
    /// Follows the agent's events: opens its socket with the user's token, calls `onOpen` once it is open, then
    /// `onEvent` for each event, and returns when the server closes the socket. Cancelling the task closes it.
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
        await onOpen()
        do {
            try await withTaskCancellationHandler {
                while let text = try await socket.receive() {
                    await onEvent(try Self.event(from: text))
                }
            } onCancel: {
                socket.close()
            }
        } catch {
            throw AppError(error)
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
