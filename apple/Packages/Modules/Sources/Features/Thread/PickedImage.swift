import Backend
import Foundation
import OSLog
import PhotosUI
import SwiftUI

nonisolated private let log = Logger(subsystem: "dev.marromugi.iris", category: "attachments")

/// An image the user picked, whose bytes are read when asked, so the thread can be tested without the photo library.
nonisolated protocol PickedImage: Sendable {
    /// The image's bytes as the library keeps them.
    func data() async throws(AppError) -> Data
}

extension PhotosPickerItem: PickedImage {
    /// Reads the photo's bytes, from iCloud when only it holds them.
    nonisolated func data() async throws(AppError) -> Data {
        do {
            guard let data = try await loadTransferable(type: Data.self) else {
                log.error("A picked photo had no data")
                throw AppError.unexpected
            }
            return data
        } catch let error as AppError {
            throw error
        } catch is CancellationError {
            throw .cancelled
        } catch {
            log.error("A picked photo could not be read: \(error.localizedDescription)")
            throw .unexpected
        }
    }
}
