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

        async let first = images.image("a", longestEdge: 780)
        async let second = images.image("a", longestEdge: 780)
        _ = try await (first, second)
        let large = try await images.image("a", longestEdge: 4096)

        #expect(shelf.reads == ["a"])
        #expect(large.width == 1568)
    }

    @Test func showsAnImageUprightNoLargerThanAskedInItsOwnShape() async throws {
        let images = PostImages(directory: FakeAgentDirectory(images: FakeImages(["a": wide])))

        guard case .shown(let image) = await images.phase(of: "a", longestEdge: 780) else {
            Issue.record("The image isn't shown")
            return
        }

        #expect(image.width == 780)
        #expect(image.height == 519)
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
        #expect(await !images.phase(of: "a", longestEdge: 780).hasFailed)

        #expect(shelf.reads == ["a", "a"])
    }

    @Test func pastTheBytesItKeepsLetsGoTheImageAskedForLongestAgo() async throws {
        let bytes = Data(repeating: 1, count: 10)
        let shelf = FakeImages(["a": bytes, "b": bytes, "c": bytes])
        let images = PostImages(directory: FakeAgentDirectory(images: shelf), keptBytes: 20)

        _ = try await images.data(of: "a")
        _ = try await images.data(of: "b")
        _ = try await images.data(of: "a")
        _ = try await images.data(of: "c")
        _ = try await images.data(of: "a")
        _ = try await images.data(of: "b")

        #expect(shelf.reads == ["a", "b", "c", "b"])
    }
}

extension PostImagePhase {
    var hasFailed: Bool {
        if case .failed = self { true } else { false }
    }
}
