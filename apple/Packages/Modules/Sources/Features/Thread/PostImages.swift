import Backend
import CoreGraphics
import Foundation
import ImageIO
import OSLog

nonisolated private let log = Logger(subsystem: "dev.marromugi.iris", category: "attachments")

/// The images the user's posts carry, read through the server once each and kept in memory while the user is signed
/// in, up to `keptBytes`; past that, the ones asked for longest ago are let go and read again when next asked for. A read
/// that failed is not kept, so the next ask tries again.
final class PostImages {
    /// How many bytes of read images are kept: about a hundred of the JPEGs the app sends.
    static let keptBytes = 48 * 1024 * 1024

    private let directory: any AgentDirectory
    private let keptBytes: Int
    /// Reads under way, so an image asked for twice at once is read once.
    private var reads: [Attachment.ID: Task<Result<Data, AppError>, Never>] = [:]
    /// The images read, the one asked for longest ago first.
    private var kept: [(id: Attachment.ID, data: Data)] = []

    init(directory: any AgentDirectory, keptBytes: Int = PostImages.keptBytes) {
        self.directory = directory
        self.keptBytes = keptBytes
    }

    private func image(_ id: Attachment.ID, longestEdge: Int) async throws(AppError) -> CGImage {
        try await Self.decoded(try await data(of: id), longestEdge: longestEdge)
    }

    /// How the image stands once it is read upright at `longestEdge` pixels: shown, or failed when it is gone or can't
    /// be read.
    func phase(of id: Attachment.ID, longestEdge: Int) async -> PostImagePhase {
        do throws(AppError) {
            return .shown(try await image(id, longestEdge: longestEdge))
        } catch {
            log.error("An image a post carries could not be shown: \(String(describing: error), privacy: .public)")
            return .failed
        }
    }

    /// The image's bytes, read through the server unless they are kept.
    private func data(of id: Attachment.ID) async throws(AppError) -> Data {
        if let index = kept.firstIndex(where: { $0.id == id }) {
            let image = kept.remove(at: index)
            kept.append(image)
            return image.data
        }
        let read = reads[id] ?? startRead(of: id)
        return try await read.value.get()
    }

    private func startRead(of id: Attachment.ID) -> Task<Result<Data, AppError>, Never> {
        let read = Task { [directory] () -> Result<Data, AppError> in
            let result: Result<Data, AppError>
            do throws(AppError) {
                result = .success(try await directory.attachment(id: id))
            } catch {
                result = .failure(error)
            }
            reads[id] = nil
            if case .success(let data) = result { keep(data, as: id) }
            return result
        }
        reads[id] = read
        return read
    }

    private func keep(_ data: Data, as id: Attachment.ID) {
        kept.append((id, data))
        var bytes = kept.reduce(0) { $0 + $1.data.count }
        // The image just read stays, even when it alone is past the limit.
        while bytes > keptBytes, kept.count > 1 {
            bytes -= kept.removeFirst().data.count
        }
    }

    @concurrent
    private static func decoded(_ data: Data, longestEdge: Int) async throws(AppError) -> CGImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = source.uprightImage(longestEdge: longestEdge)
        else {
            log.error("An image a post carries could not be read")
            throw .unexpected
        }
        return image
    }
}

/// How one of a post's images stands on screen.
enum PostImagePhase {
    case reading
    case shown(CGImage)
    /// It is gone, or could not be read.
    case failed
}
