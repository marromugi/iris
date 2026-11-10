import Testing

@testable import Features

struct TypewriterTests {
    // Each phrase takes: 3 × 100 ms typing, 1 s held, 3 × 50 ms deleting, 200 ms empty = 1650 ms.
    let typewriter = Typewriter(
        phrases: ["考え中", "うーん"], typeEach: .milliseconds(100), deleteEach: .milliseconds(50),
        holdTyped: .seconds(1), holdDeleted: .milliseconds(200))

    @Test(
        arguments: [
            (0, ""),
            (150, "考"),
            (300, "考え中"),
            (1250, "考え中"),
            (1360, "考え"),
            (1460, ""),
            (1650, ""),
            (1760, "う"),
            (3300, ""),
            (3400, "考"),
        ] as [(Int, String)])
    func typesHoldsAndDeletesEachPhraseInTurnAndStartsOver(milliseconds: Int, text: String) {
        #expect(typewriter.text(after: .milliseconds(milliseconds)) == text)
    }

    @Test func showsNothingWithoutPhrases() {
        #expect(Typewriter(phrases: []).text(after: .seconds(1)) == "")
    }
}
