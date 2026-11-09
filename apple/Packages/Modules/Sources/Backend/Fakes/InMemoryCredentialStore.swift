#if DEBUG
    import Synchronization

    /// A sign-in kept in memory, for previews and tests.
    public final class InMemoryCredentialStore: CredentialStore {
        private let credentials: Mutex<Credentials?>

        public init(_ credentials: Credentials? = nil) {
            self.credentials = Mutex(credentials)
        }

        public func load() -> Credentials? {
            credentials.withLock { $0 }
        }

        public func save(_ credentials: Credentials?) {
            self.credentials.withLock { $0 = credentials }
        }
    }
#endif
