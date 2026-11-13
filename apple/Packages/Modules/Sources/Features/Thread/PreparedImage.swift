import Backend
import CoreGraphics
import Foundation
import ImageIO
import OSLog
import UniformTypeIdentifiers

nonisolated private let log = Logger(subsystem: "dev.marromugi.iris", category: "attachments")

/// A picked image made ready to put up: a JPEG no longer than `longestEdge` on either side, turned the way it is
/// shown, and a small copy for the message bar.
nonisolated struct PreparedImage: Sendable {
    /// The longest side, in pixels, of an image sent to the model. Anthropic's vision guide sizes images to this so the
    /// model doesn't shrink them again.
    static let longestEdge = 1568
    /// The longest side, in pixels, of the copy the message bar shows: its 44-point square at 3x.
    static let thumbnailEdge = 132
    static let jpegQuality = 0.8

    let jpeg: Data
    let thumbnail: CGImage

    /// Reads `data` as any image ImageIO knows (HEIC, PNG, JPEG, …), shrinks it to `longestEdge` if it is larger, and
    /// writes it as a JPEG. Data that isn't an image is `.unexpected`.
    @concurrent
    static func make(from data: Data) async throws(AppError) -> PreparedImage {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = scaled(source, longestEdge: longestEdge)
        else {
            log.error("A picked image could not be read")
            throw .unexpected
        }
        let jpeg = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(jpeg, UTType.jpeg.identifier as CFString, 1, nil)
        else { preconditionFailure("ImageIO writes JPEG") }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary)
        guard CGImageDestinationFinalize(destination),
            let written = CGImageSourceCreateWithData(jpeg, nil),
            let thumbnail = scaled(written, longestEdge: thumbnailEdge)
        else {
            log.error("A picked image could not be written as JPEG")
            throw .unexpected
        }
        return PreparedImage(jpeg: jpeg as Data, thumbnail: thumbnail)
    }

    /// The source's first image turned upright, no longer than `longestEdge` on either side. ImageIO never makes an
    /// image larger here.
    private static func scaled(_ source: CGImageSource, longestEdge: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: longestEdge,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
