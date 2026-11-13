import Backend
import CoreGraphics
import Foundation
import Testing

@testable import Features

struct PostImagesTests {
    let wide = Samples.pictureBytes["picture-wide"] ?? Data()

    @Test func readsAnImageOnceHoweverOftenAndAtWhateverSizeItIsShown() async throws {
        let shelf = FakeImages(["a": wide])
        let images = PostImages(directory: FakeAgentDirectory(images: shelf))

        async let first = images.phase(of: "a", longestEdge: 780)
        async let second = images.phase(of: "a", longestEdge: 780)
        _ = await (first, second)
        let large = try #require(await images.phase(of: "a", longestEdge: 4096).image)

        #expect(shelf.reads == ["a"])
        #expect(large.width == 1568)
    }

    @Test func showsAnImageNoLargerThanAskedInItsOwnShape() async throws {
        let images = PostImages(directory: FakeAgentDirectory(images: FakeImages(["a": wide])))

        let image = try #require(await images.phase(of: "a", longestEdge: 780).image)

        #expect(image.width == 780)
        #expect(image.height == 519)
    }

    @Test func showsAPhotoTheWayItsEXIFSaysToTurnIt() async throws {
        let images = PostImages(
            directory: FakeAgentDirectory(images: FakeImages(["a": Samples.turnedPhoto(width: 300, height: 200)])))

        let image = try #require(await images.phase(of: "a", longestEdge: 780).image)

        #expect(image.width == 200)
        #expect(image.height == 300)
    }

    @Test func anImageThatIsGoneOrIsNoImageFails() async {
        let images = PostImages(directory: FakeAgentDirectory(images: FakeImages(["text": Data("hello".utf8)])))

        #expect(await images.phase(of: "gone", longestEdge: 780).hasFailed)
        #expect(await images.phase(of: "text", longestEdge: 780).hasFailed)
    }

    @Test func aReadThatFailedIsTriedAgainNextTime() async {
        let shelf = FakeImages(["a": wide])
        let images = PostImages(directory: FakeAgentDirectory(images: shelf))
        shelf.fail(with: .offline)

        #expect(await images.phase(of: "a", longestEdge: 780).hasFailed)
        shelf.fail(with: nil)
        #expect(await images.phase(of: "a", longestEdge: 780).image != nil)

        #expect(shelf.reads == ["a", "a"])
    }

    @Test func pastTheBytesItKeepsLetsGoTheImageAskedForLongestAgo() async {
        let shelf = FakeImages(["a": wide, "b": wide, "c": wide])
        let images = PostImages(directory: FakeAgentDirectory(images: shelf), keptBytes: 2 * wide.count)

        for id in ["a", "b", "a", "c", "a", "b"] {
            _ = await images.phase(of: id, longestEdge: 780)
        }

        #expect(shelf.reads == ["a", "b", "c", "b"])
    }

    @Test func keepsTheImageJustReadEvenWhenItAloneIsPastTheBytesItKeeps() async {
        let shelf = FakeImages(["a": wide])
        let images = PostImages(directory: FakeAgentDirectory(images: shelf), keptBytes: 1)

        _ = await images.phase(of: "a", longestEdge: 780)
        _ = await images.phase(of: "a", longestEdge: 780)

        #expect(shelf.reads == ["a"])
    }
}

extension PostImagePhase {
    var hasFailed: Bool {
        if case .failed = self { true } else { false }
    }

    var image: CGImage? {
        if case .shown(let image) = self { image } else { nil }
    }
}
