import Backend

/// What a screen has of what it reads: still coming, there, or not to be had.
enum Loadable<Value> {
    case loading
    case loaded(Value)
    case failed(AppError)

    /// What the screen has after reading again. What is already shown stays when the read is cancelled (the screen
    /// went away) or when reading it again fails (coming back to the screen offline); only a first read shows its
    /// failure.
    func reading(_ read: () async throws(AppError) -> Value) async -> Loadable<Value> {
        do throws(AppError) {
            return .loaded(try await read())
        } catch .cancelled {
            return self
        } catch {
            if case .loaded = self { return self }
            return .failed(error)
        }
    }
}
