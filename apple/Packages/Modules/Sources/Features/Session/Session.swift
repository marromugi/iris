import Backend
import Observation
import os

private let log = Logger(subsystem: "dev.marromugi.iris", category: "time-zone")

/// What the session needs from the server, so it can be shown and tested with a fake.
nonisolated protocol SessionBackend: Sendable {
    var isSignedIn: Bool { get async }
    func signIn(authenticate: @escaping Authenticate) async throws(AppError)
    func signOut() async
    func setTimeZone(_ identifier: String) async throws(AppError)
}

extension IrisBackend: SessionBackend {}

/// Whether the user is signed in. Everything the app shows waits on this.
@Observable
final class Session {
    enum State: Equatable {
        /// Looking at the sign-in kept from last time.
        case checking
        case signedOut
        case signingIn
        /// Holding a sign-in. The server may still refuse it; the screen that hears so offers to sign in again.
        case signedIn
    }

    private(set) var state: State = .checking
    /// Why the last sign-in did not go through, for the sign-in screen to say.
    private(set) var problem: AppError?

    private let backend: any SessionBackend

    init(backend: any SessionBackend) {
        self.backend = backend
    }

    /// Picks up the sign-in kept from last time, if there is one.
    func start() async {
        state = await backend.isSignedIn ? .signedIn : .signedOut
    }

    /// Opens the sign-in sheet, and gives back the work, which ends signed in or with a problem to show. Does nothing
    /// while a sign-in is already open.
    @discardableResult
    func signIn(authenticate: @escaping Authenticate) -> Task<Void, Never> {
        guard state != .signingIn else { return Task {} }
        state = .signingIn
        problem = nil
        return Task {
            do throws(AppError) {
                try await backend.signIn(authenticate: authenticate)
                state = .signedIn
            } catch .cancelled {
                state = .signedOut
            } catch {
                problem = error
                state = .signedOut
            }
        }
    }

    /// Shows the sign-in screen at once; the server hears of it afterwards.
    func signOut() async {
        problem = nil
        state = .signedOut
        await backend.signOut()
    }

    /// Tells the server the device's time zone now, and again each time `changes` says it changed, until the task is
    /// cancelled. A send that fails is logged, not shown; the next change or launch sends again.
    func keepTimeZoneSent(current: () -> String, changes: some AsyncSequence<Void, Never>) async {
        await sendTimeZone(current())
        for await _ in changes {
            await sendTimeZone(current())
        }
    }

    private func sendTimeZone(_ identifier: String) async {
        do throws(AppError) {
            try await backend.setTimeZone(identifier)
        } catch .cancelled {
        } catch {
            log.error("Could not set the time zone \(identifier, privacy: .public): \(String(describing: error))")
        }
    }
}
