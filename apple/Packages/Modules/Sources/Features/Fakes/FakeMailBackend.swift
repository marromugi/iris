#if DEBUG
    import Backend
    import Foundation
    import Synchronization

    /// A mail backend that answers as it is told, for previews and tests. Its events socket opens and then stays open,
    /// sending what the test sends with `send`, until the task is cancelled.
    final class FakeMailBackend: MailBackend {
        struct Answers: Sendable {
            var setup: Result<MailSetup, AppError> = .success(MailSetup())
            var makeAddress: Result<MailSetup, AppError> = .success(FakeMailBackend.waitingSetup)
            var stop: Result<Void, AppError> = .success(())
            var dismiss: Result<Void, AppError> = .success(())
            var follow: AppError? = nil
            /// Whether reads wait for `releaseRead()` before they answer.
            var holdsReads = false
            /// How many times each call was made, and each events socket opened.
            var madeAddresses = 0
            var stopped = 0
            var dismissed = 0
            var socketsOpened = 0
        }

        static let address = "iris+0123456789abcdef01234567@marromugi.me"
        static let confirmation = MailConfirmation(
            url: "https://mail-settings.google.com/mail/vf-abc", code: "123456789",
            receivedAt: Date(timeIntervalSince1970: 1_794_480_000))
        static let waitingSetup = MailSetup(address: address)
        static let confirmationSetup = MailSetup(address: address, confirmation: confirmation)
        static let receivingSetup = MailSetup(
            address: address, lastMailAt: Date(timeIntervalSince1970: 1_794_480_600))

        private let answers: Mutex<Answers>
        private let heldReads = Mutex<[CheckedContinuation<Void, Never>]>([])
        private let events: AsyncStream<UserEvent>
        private let eventSink: AsyncStream<UserEvent>.Continuation

        init(_ answers: Answers = Answers()) {
            self.answers = Mutex(answers)
            (events, eventSink) = AsyncStream.makeStream()
        }

        /// Sets the answers from now on.
        func answer(_ change: @Sendable (inout Answers) -> Void) {
            answers.withLock { change(&$0) }
        }

        /// Sends an event on the open socket.
        func send(_ event: UserEvent) {
            eventSink.yield(event)
        }

        var madeAddresses: Int { answers.withLock { $0.madeAddresses } }
        var stopped: Int { answers.withLock { $0.stopped } }
        var dismissed: Int { answers.withLock { $0.dismissed } }
        var socketsOpened: Int { answers.withLock { $0.socketsOpened } }
        var readsWaiting: Int { heldReads.withLock { $0.count } }

        /// Lets the reads waiting go on, each answering what `setup` says by then.
        func releaseReads() {
            for read in heldReads.withLock({ held in
                defer { held = [] }
                return held
            }) {
                read.resume()
            }
        }

        func mailSetup() async throws(AppError) -> MailSetup {
            if answers.withLock({ $0.holdsReads }) {
                await withCheckedContinuation { read in heldReads.withLock { $0.append(read) } }
            }
            return try answers.withLock { $0.setup }.get()
        }

        func makeMailAddress() async throws(AppError) -> MailSetup {
            try answers.withLock {
                $0.madeAddresses += 1
                return $0.makeAddress
            }.get()
        }

        func stopMail() async throws(AppError) {
            try answers.withLock {
                $0.stopped += 1
                return $0.stop
            }.get()
        }

        func dismissMailConfirmation() async throws(AppError) {
            try answers.withLock {
                $0.dismissed += 1
                return $0.dismiss
            }.get()
        }

        func followUserEvents(
            onOpen: @Sendable () async -> Void,
            onEvent: @Sendable (UserEvent) async -> Void
        ) async throws(AppError) {
            let failure = answers.withLock {
                $0.socketsOpened += 1
                return $0.follow
            }
            if let failure { throw failure }
            await onOpen()
            for await event in events {
                await onEvent(event)
            }
            throw .cancelled
        }
    }
#endif
