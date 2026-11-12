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
        /// The link was opened: turn forwarding on in the settings of the Gmail account that asked, when known.
        case turnOnForwarding(account: String?)

        /// One for both, so going from one step to the next keeps the sheet up and changes what it shows.
        var id: String { "mail setup" }
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
    /// Each read and change takes the next number when it starts; `shown` is the number of what the screen shows. A
    /// read or change that ends after a later one started is dropped, so an answer that left earlier never replaces one
    /// that left later, as when the event of a new address starts a read before the new address comes back.
    private var started = 0
    private var shown = 0
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
        let number = start()
        let result: Result<MailSetup, AppError>
        do throws(AppError) {
            result = .success(try await backend.mailSetup())
        } catch {
            result = .failure(error)
        }
        guard isLatest(number) else { return }
        show(setup.applying(result))
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
                reset()
                setup = .failed(.signedOut)
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

    /// Stops receiving mail: the address goes, and so does the mail kept for the agents. The setup is then empty, so
    /// it isn't read again.
    func stop() {
        change { () async throws(AppError) in
            try await self.backend.stopMail()
            return MailSetup()
        }
    }

    /// The user opened the confirmation's link: what is left is turning forwarding on in Gmail. The confirmation
    /// stays on the server until that step is closed, so a link that didn't work can be opened again from the mail
    /// screen.
    func openedConfirmation() {
        guard case .confirm(let confirmation) = offer else { return }
        handledConfirmationAt = confirmation.receivedAt
        offer = .turnOnForwarding(account: confirmation.account)
    }

    /// The user closed the sheet. A confirmation closed unopened stays, and the mail screen can offer it again. Closing
    /// the last step has the server let go of the confirmation it followed. A confirmation that arrived while the
    /// sheet showed that step is offered now.
    func closeOffer() {
        switch offer {
        case .confirm(let confirmation):
            handledConfirmationAt = confirmation.receivedAt
        case .turnOnForwarding:
            letGoOfConfirmation()
        case nil:
            break
        }
        offer = nil
        show(setup)
    }

    /// Forgets the user's setup, as when they sign out, so the next user starts from nothing. A read or change still
    /// on its way is dropped.
    func reset() {
        shown = start()
        setup = .loading
        offer = nil
        problem = nil
        handledConfirmationAt = nil
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
        let number = start()
        Task {
            defer { isChanging = false }
            let result: Result<MailSetup, AppError>
            do throws(AppError) {
                result = .success(try await make())
            } catch {
                result = .failure(error)
            }
            guard isLatest(number) else { return }
            switch result {
            case .success(let made): show(.loaded(made))
            case .failure(.cancelled): break
            case .failure(.signedOut): show(.failed(.signedOut))
            case .failure(let error): problem = error
            }
        }
    }

    /// Has the server let go of the confirmation once its last step is done. A failure leaves it on the server, where
    /// the mail screen still offers it, and says why.
    private func letGoOfConfirmation() {
        let number = start()
        Task {
            do throws(AppError) {
                try await backend.dismissMailConfirmation()
            } catch .cancelled {
            } catch {
                log.error("Could not let go of the confirmation: \(String(describing: error))")
                if isLatest(number) { problem = error }
            }
        }
    }

    /// The number of a read or change starting now.
    private func start() -> Int {
        started += 1
        return started
    }

    /// Whether the read or change numbered `number` is newer than what is shown, and so to be shown; it then is.
    private func isLatest(_ number: Int) -> Bool {
        guard number > shown else { return false }
        shown = number
        return true
    }

    /// Shows what was read, and offers a confirmation that arrived and isn't handled yet. A sheet already asking to
    /// turn forwarding on stays.
    private func show(_ read: Loadable<MailSetup>) {
        setup = read
        if case .turnOnForwarding = offer { return }
        if let confirmation = read.value?.confirmation, confirmation.receivedAt != handledConfirmationAt {
            offer = .confirm(confirmation)
        } else if case .confirm = offer, read.value?.confirmation == nil {
            offer = nil
        }
    }
}
