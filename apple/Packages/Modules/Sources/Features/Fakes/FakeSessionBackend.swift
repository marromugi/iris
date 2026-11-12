#if DEBUG
    import Backend
    import Synchronization

    /// A session backend that answers as it is told, for previews and tests.
    final class FakeSessionBackend: SessionBackend {
        struct Answers: Sendable {
            var isSignedIn = false
            var signIn: Result<Void, AppError> = .success(())
            var setTimeZone: Result<Void, AppError> = .success(())
            /// Every time zone the app has sent, failed sends too, in order.
            var timeZonesSent: [String] = []
        }

        private let answers: Mutex<Answers>

        init(_ answers: Answers = Answers()) {
            self.answers = Mutex(answers)
        }

        var isSignedIn: Bool {
            get async { answers.withLock { $0.isSignedIn } }
        }

        func signIn(authenticate: @escaping Authenticate) async throws(AppError) {
            try answers.withLock { $0.signIn }.get()
            answers.withLock { $0.isSignedIn = true }
        }

        func signOut() async {
            answers.withLock { $0.isSignedIn = false }
        }

        func setTimeZone(_ identifier: String) async throws(AppError) {
            try answers.withLock {
                $0.timeZonesSent.append(identifier)
                return $0.setTimeZone
            }.get()
        }

        var timeZonesSent: [String] {
            answers.withLock { $0.timeZonesSent }
        }
    }
#endif
