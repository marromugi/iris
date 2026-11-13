#if DEBUG
    import Backend
    import Foundation

    /// A picked image as it is told to be, for previews and tests: its bytes are `bytes`, reading it fails with
    /// `failure` when one is set, and it waits for `gate` to open first when one is given.
    nonisolated struct FakePickedImage: PickedImage {
        var bytes = Samples.photo(width: 2000, height: 1500)
        var failure: AppError?
        var gate: Gate?

        func data() async throws(AppError) -> Data {
            if let gate { await gate.passed() }
            if let failure { throw failure }
            return bytes
        }

        /// Holds whoever reads the image until it is opened, so the time before it is read can be seen.
        actor Gate {
            private var isOpen = false
            private var waiting: [CheckedContinuation<Void, Never>] = []

            func passed() async {
                guard !isOpen else { return }
                await withCheckedContinuation { waiting.append($0) }
            }

            func open() {
                isOpen = true
                for continuation in waiting { continuation.resume() }
                waiting = []
            }
        }
    }
#endif
