import Backend
import CoreGraphics
import Foundation
import ImageIO
import Testing

@testable import Features

struct PreparedImageTests {
    /// The width and height of the image `data` holds, and its type.
    func shape(of data: Data) throws -> (width: Int, height: Int, type: String) {
        let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        return (
            try #require(properties[kCGImagePropertyPixelWidth] as? Int),
            try #require(properties[kCGImagePropertyPixelHeight] as? Int),
            try #require(CGImageSourceGetType(source) as String?)
        )
    }

    @Test(arguments: [
        (2000, 1500, 1568, 1176),
        (1200, 3000, 627, 1568),
        (800, 600, 800, 600),
    ])
    func makesAJPEGNoLongerThanTheLongestEdgeAndNeverLarger(
        width: Int, height: Int, expectedWidth: Int, expectedHeight: Int
    ) async throws {
        let prepared = try await PreparedImage.make(from: Samples.photo(width: width, height: height))

        let jpeg = try shape(of: prepared.jpeg)
        #expect(jpeg.type == "public.jpeg")
        #expect(jpeg.width == expectedWidth)
        #expect(jpeg.height == expectedHeight)
        #expect(max(prepared.thumbnail.width, prepared.thumbnail.height) == PreparedImage.thumbnailEdge)
    }

    @Test func turnsAPhotoTheWayItIsShown() async throws {
        // Stored 300 wide and 100 high, shown turned a quarter clockwise, as an iPhone keeps a photo taken upright.
        let stored = try #require(
            CGImageSourceCreateWithData(Samples.photo(width: 300, height: 100) as CFData, nil)
                .flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) })
        let jpeg = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(jpeg, "public.jpeg" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, stored, [kCGImagePropertyOrientation: 6] as CFDictionary)
        #expect(CGImageDestinationFinalize(destination))

        let prepared = try await PreparedImage.make(from: jpeg as Data)

        let shown = try shape(of: prepared.jpeg)
        #expect(shown.width == 100)
        #expect(shown.height == 300)
    }

    @Test func dataThatIsNotAnImageIsUnexpected() async {
        await #expect(throws: AppError.unexpected) {
            try await PreparedImage.make(from: Data("not an image".utf8))
        }
    }
}
