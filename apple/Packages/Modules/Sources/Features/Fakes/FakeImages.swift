#if DEBUG
    import Backend
    import Foundation
    import Synchronization

    /// The images posts carry, as they are told to be, for previews and tests: each read gives back the bytes kept
    /// under its ID, and fails with `failure` when one is set; an image not kept is gone.
    nonisolated final class FakeImages: Sendable {
        private struct State {
            var images: [Attachment.ID: Data]
            var failure: AppError?
            var reads: [Attachment.ID] = []
        }

        private let state: Mutex<State>

        init(_ images: [Attachment.ID: Data] = [:]) {
            state = Mutex(State(images: images))
        }

        /// The IDs of the images read, in order.
        var reads: [Attachment.ID] {
            state.withLock { $0.reads }
        }

        func fail(with failure: AppError?) {
            state.withLock { $0.failure = failure }
        }

        func read(_ id: Attachment.ID) throws(AppError) -> Data {
            try state.withLock { state throws(AppError) in
                state.reads.append(id)
                if let failure = state.failure { throw failure }
                guard let data = state.images[id] else { throw .refused(message: "No image of this user has this ID") }
                return data
            }
        }
    }
#endif
