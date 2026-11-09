import Backend
import Testing

@testable import Features

struct LoadableTests {
    @Test func showsWhatItRead() async {
        let state = await Loadable<String>.loading.reading { () async throws(AppError) -> String in "読めた" }

        guard case .loaded("読めた") = state else {
            Issue.record("expected the value, got \(state)")
            return
        }
    }

    @Test func showsWhyTheFirstReadFailed() async {
        let state = await Loadable<String>.loading.reading { () async throws(AppError) -> String in throw .offline }

        guard case .failed(.offline) = state else {
            Issue.record("expected the failure, got \(state)")
            return
        }
    }

    @Test(arguments: [AppError.cancelled, .offline])
    func keepsWhatItShowsWhenReadingAgainDoesNotGoThrough(error: AppError) async {
        let state = await Loadable<String>.loaded("前に読んだ").reading { () async throws(AppError) -> String in throw error }

        guard case .loaded("前に読んだ") = state else {
            Issue.record("expected what was read before, got \(state)")
            return
        }
    }

    @Test func showsNothingNewWhenTheFirstReadIsCancelled() async {
        let state = await Loadable<String>.loading.reading { () async throws(AppError) -> String in throw .cancelled }

        guard case .loading = state else {
            Issue.record("expected it to be still loading, got \(state)")
            return
        }
    }
}
