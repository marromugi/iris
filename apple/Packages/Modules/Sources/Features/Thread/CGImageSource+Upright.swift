import CoreGraphics
import ImageIO

nonisolated extension CGImageSource {
    /// The source's first image turned upright, no longer than `longestEdge` pixels on either side. ImageIO never makes
    /// an image larger here.
    func uprightImage(longestEdge: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: longestEdge,
        ]
        return CGImageSourceCreateThumbnailAtIndex(self, 0, options as CFDictionary)
    }
}
