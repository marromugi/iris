import Backend
import CoreGraphics
import Foundation
import Observation

/// An image the user picked for their next post, from reading it to having it put up on the server.
@Observable
final class AttachedImage: Identifiable {
    enum State: Equatable {
        /// Being read and made a JPEG.
        case preparing
        /// Being put up on the server.
        case uploading
        /// Put up, under this ID; ready to send.
        case uploaded(Attachment.ID)
        /// Could not be read or put up, for this reason; it can be tried again.
        case failed(AppError)
    }

    private(set) var state = State.preparing
    /// The small copy the message bar shows, once the image has been read.
    private(set) var thumbnail: CGImage?

    private let picked: any PickedImage
    private let backend: any ThreadBackend
    @ObservationIgnored private var jpeg: Data?
    @ObservationIgnored private var work: Task<Void, Never>?

    init(picked: any PickedImage, backend: any ThreadBackend) {
        self.picked = picked
        self.backend = backend
    }

    /// The ID it was put up under; nil until it is.
    var uploadedID: Attachment.ID? {
        guard case .uploaded(let id) = state else { return nil }
        return id
    }

    /// Reads the image, makes it a JPEG, and puts it up.
    @discardableResult
    func start() -> Task<Void, Never> {
        state = jpeg == nil ? .preparing : .uploading
        let work = Task { await run() }
        self.work = work
        return work
    }

    /// Tries again from where it failed: reading it, or putting it up.
    @discardableResult
    func retry() -> Task<Void, Never>? {
        guard case .failed = state else { return nil }
        return start()
    }

    /// Stops what it is doing, once it is taken off the post. An image already put up stays on the server until it
    /// removes it, a day later.
    func cancel() {
        work?.cancel()
    }

    private func run() async {
        do throws(AppError) {
            let jpeg = try await jpegReady()
            // Making the JPEG doesn't stop for a cancel, so one taken off meanwhile is caught here.
            if Task.isCancelled { return }
            state = .uploading
            let id = try await backend.putUp(jpeg: jpeg)
            state = .uploaded(id)
        } catch .cancelled {
            // Only taken off the post cancels it, and then nothing shows it.
        } catch {
            state = .failed(error)
        }
    }

    private func jpegReady() async throws(AppError) -> Data {
        if let jpeg { return jpeg }
        let prepared = try await PreparedImage.make(from: try await picked.data())
        jpeg = prepared.jpeg
        thumbnail = prepared.thumbnail
        return prepared.jpeg
    }
}
