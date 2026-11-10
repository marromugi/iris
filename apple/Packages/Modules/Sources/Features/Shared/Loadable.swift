import Backend

/// What a screen has of what it reads: still coming, there, or not to be had.
enum Loadable<Value> {
    case loading
    case loaded(Value)
    case failed(AppError)

    /// What the screen has after reading again. What is already shown stays when the read is cancelled (the screen
    /// went away) or when reading it again fails (coming back to the screen offline); only a first read shows its
    /// failure. An ended sign-in always shows, since nothing read from then on can work without signing in again.
    func reading(_ read: () async throws(AppError) -> Value) async -> Loadable<Value> {
        do throws(AppError) {
            return applying(.success(try await read()))
        } catch {
            return applying(.failure(error))
        }
    }

    /// What the screen has once a read ends with `result`, by the rules of `reading`, kept apart for a screen whose
    /// value changes while the read is on its way: it applies the result to what the screen has by then.
    func applying(_ result: Result<Value, AppError>) -> Loadable<Value> {
        switch result {
        case .success(let value):
            return .loaded(value)
        case .failure(.cancelled):
            return self
        case .failure(.signedOut):
            return .failed(.signedOut)
        case .failure(let error):
            if case .loaded = self { return self }
            return .failed(error)
        }
    }
}
