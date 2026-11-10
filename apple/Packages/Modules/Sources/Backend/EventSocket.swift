import Foundation

/// One WebSocket as the app reads it: opened, then text messages from the server until it closes. `URLSession` in the
/// app, a fake in tests.
public protocol EventSocket: Sendable {
    /// Returns once the socket is open; throws when it could not be opened, or when the task was cancelled meanwhile.
    func open() async throws(SocketRefusal)
    /// The next text message, or nil once the socket closed.
    func receive() async throws -> String?
    /// Returns once the server answers a ping; throws when the socket is gone.
    func ping() async throws
    /// Closes the socket; a read or ping waiting on it ends.
    func close()
}

/// Why a socket did not open: the HTTP status the server answered the upgrade with, when it answered, and the failure
/// as the app sees it otherwise.
public struct SocketRefusal: Error {
    public let status: Int?
    public let failure: AppError

    public init(status: Int?, failure: AppError) {
        self.status = status
        self.failure = failure
    }
}

/// Makes the socket for an upgrade request.
public typealias OpenSocket = @Sendable (URLRequest) -> any EventSocket

/// How an open socket is checked on: a ping this often, answered within this long.
public struct SocketPings: Sendable {
    public let every: Duration
    public let answerWithin: Duration

    public init(every: Duration, answerWithin: Duration) {
        self.every = every
        self.answerWithin = answerWithin
    }
}

/// A socket over `URLSessionWebSocketTask`. It counts as open once the server answers a ping, which it can only do on
/// an open socket.
public final class URLSessionEventSocket: EventSocket {
    private let task: URLSessionWebSocketTask

    public init(request: URLRequest, session: URLSession = .shared) {
        task = session.webSocketTask(with: request)
    }

    public func open() async throws(SocketRefusal) {
        task.resume()
        do {
            try await withTaskCancellationHandler {
                try await ping()
            } onCancel: {
                close()
            }
        } catch {
            throw SocketRefusal(status: (task.response as? HTTPURLResponse)?.statusCode, failure: AppError(error))
        }
    }

    public func receive() async throws -> String? {
        while true {
            do {
                switch try await task.receive() {
                case .string(let text): return text
                case .data(let data): return String(decoding: data, as: UTF8.self)
                @unknown default: continue  // A kind of message the app can't read is passed over.
                }
            } catch {
                // A socket that closed throws on the next read; that is its end, not a failure.
                if task.closeCode != .invalid { return nil }
                throw error
            }
        }
    }

    public func ping() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            task.sendPing { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    public func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }
}
