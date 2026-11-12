import Backend
import Foundation
import Observation
import os

private let log = Logger(subsystem: "dev.marromugi.iris", category: "mail")

/// The user's mail setup for the whole app: where it stands, kept current from the user's events socket, the changes
/// the user makes to it, and the sheet that walks them through Gmail's forwarding confirmation, whichever screen is
/// shown when it arrives.
@Observable
final class MailSetupModel {
    /// The sheet the app offers about the setup.
    enum Offer: Identifiable, Equatable {
        /// Gmail's confirmation arrived: open its link.
        case confirm(MailConfirmation)
        /// The link was opened: turn forwarding on in Gmail's settings.
        case turnOnForwarding

        var id: String {
            switch self {
            case .confirm(let confirmation): "confirm \(confirmation.url)"
            case .turnOnForwarding: "turn on forwarding"
            }
        }
    }

    private(set) var setup = Loadable<MailSetup>.loading
    /// The sheet to show; nil when none is.
    private(set) var offer: Offer?
    /// Whether a new address is being made or mail is being stopped; the screen holds its buttons meanwhile.
    private(set) var isChanging = false
    /// Why the last change didn't go through, for the screen to say.
    private(set) var problem: AppError?

    /// When the confirmation the user already opened or put off arrived; that one isn't offered again by itself.
    private var handledConfirmationAt: Date?
    private var openedAt: ContinuousClock.Instant?
    private let backend: any MailBackend
    private let wait: @Sendable (Duration) async throws -> Void
    private let now: () -> ContinuousClock.Instant

    init(
        backend: any MailBackend,
        wait: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> ContinuousClock.Instant = { .now }
    ) {
        self.backend = backend
        self.wait = wait
        self.now = now
    }

    /// Reads where the setup stands.
    func load() async {
        let read = await setup.reading { () async throws(AppError) in try await backend.mailSetup() }
        show(read)
    }

    /// Keeps the setup current while the app is in the foreground: opens the user's events socket, reads the setup
    /// once it is open and again on each event. After the socket closes or fails, it opens it again as a thread's is
    /// (`SocketReopening`). It stops when cancelled, and opens no more sockets once the sign-in ends.
    func follow() async {
        var failures = 0
        while !Task.isCancelled {
            openedAt = nil
            do throws(AppError) {
                try await backend.followUserEvents {
                    await self.opened()
                } onEvent: { _ in
                    await self.load()
                }
            } catch .cancelled {
                return
            } catch .signedOut {
                show(.failed(.signedOut))
                return
            } catch {
                // Counted below, by how long the socket stayed open.
            }
            if Task.isCancelled { return }
            if let openedAt, now() - openedAt >= SocketReopening.openLongEnough {
                failures = 0
            } else {
                failures += 1
                await load()
                if case .failed(.signedOut) = setup { return }
            }
            do {
                try await wait(SocketReopening.delay(afterFailures: failures))
            } catch {
                return
            }
        }
    }

    /// Makes a new address, in place of any the user had. Does nothing while a change is on its way, so a second tap
    /// doesn't retire the address just made.
    func makeAddress() {
        change { () async throws(AppError) in try await self.backend.makeMailAddress() }
    }

    /// Stops receiving mail: the address goes, and so does the mail kept for the agents.
    func stop() {
        change { () async throws(AppError) in
            try await self.backend.stopMail()
            return try await self.backend.mailSetup()
        }
    }

    /// The user opened the confirmation's link: what is left is turning forwarding on in Gmail, and the server lets
    /// go of the confirmation so it isn't offered again.
    func openedConfirmation() {
        guard case .confirm(let confirmation) = offer else { return }
        handledConfirmationAt = confirmation.receivedAt
        offer = .turnOnForwarding
        Task {
            do throws(AppError) {
                try await backend.dismissMailConfirmation()
            } catch .cancelled {
            } catch {
                log.error("Could not let go of the confirmation: \(String(describing: error))")
            }
        }
    }

    /// The user closed the sheet. A confirmation closed unopened stays on the mail screen, which can offer it again.
    func closeOffer() {
        if case .confirm(let confirmation) = offer {
            handledConfirmationAt = confirmation.receivedAt
        }
        offer = nil
    }

    /// Offers the confirmation waiting on the server again, as from the mail screen.
    func offerConfirmation() {
        guard let confirmation = setup.value?.confirmation else { return }
        offer = .confirm(confirmation)
    }

    private func opened() async {
        openedAt = now()
        await load()
    }

    private func change(_ make: @escaping () async throws(AppError) -> MailSetup) {
        guard !isChanging else { return }
        isChanging = true
        problem = nil
        Task {
            do throws(AppError) {
                show(.loaded(try await make()))
            } catch .cancelled {
            } catch .signedOut {
                show(.failed(.signedOut))
            } catch {
                problem = error
            }
            isChanging = false
        }
    }

    /// Shows what was read, and offers a confirmation that arrived and isn't handled yet. A sheet already asking to
    /// turn forwarding on stays.
    private func show(_ read: Loadable<MailSetup>) {
        setup = read
        if offer == .turnOnForwarding { return }
        if let confirmation = read.value?.confirmation, confirmation.receivedAt != handledConfirmationAt {
            offer = .confirm(confirmation)
        } else if case .confirm = offer, read.value?.confirmation == nil {
            offer = nil
        }
    }
}
