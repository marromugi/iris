import Testing

@testable import Features

struct PhraseFaderTests {
    // Each phrase takes 100 ms fading in, 1 s showing, 100 ms fading out: 1200 ms.
    let fader = PhraseFader(phrases: ["a", "b", "c", "d"], fade: .milliseconds(100), hold: .seconds(1))

    @Test(
        arguments: [
            (0, "a", 0.0),
            (50, "a", 0.5),
            (100, "a", 1.0),
            (1100, "a", 1.0),
            (1150, "a", 0.5),
            (1199, "a", 0.01),
            (1200, "b", 0.0),
            (1250, "b", 0.5),
        ] as [(Int, String, Double)])
    func fadesInStaysAndFadesOutChangingOnlyWhileNothingShows(milliseconds: Int, text: String, opacity: Double) {
        let frame = fader.frame(after: .milliseconds(milliseconds))

        #expect(frame.text == text)
        #expect(abs(frame.opacity - opacity) < 0.0001)
    }

    @Test func showsEveryPhraseOnceBeforeAnyComesAgain() {
        let phrases = (0..<100).map { "p\($0)" }
        let fader = PhraseFader(phrases: phrases)

        let firstRound = (0..<100).map { fader.phrase(at: $0) }

        #expect(firstRound.first == "p0")
        #expect(Set(firstRound).count == 100)
        #expect(fader.phrase(at: 100) == "p0")
        #expect(firstRound.prefix(3) != ["p0", "p1", "p2"])
    }

    @Test func scattersAFewPhrasesTooWhenTheCountAllowsIt() {
        let fader = PhraseFader(phrases: (0..<10).map { "p\($0)" })

        let firstRound = (0..<10).map { fader.phrase(at: $0) }

        #expect(Set(firstRound).count == 10)
        #expect(firstRound.prefix(3) != ["p0", "p1", "p2"])
        #expect(firstRound.prefix(3) != ["p0", "p9", "p8"])
    }

    @Test func thereAreAHundredDifferentThinkingPhrases() {
        #expect(Set(ThinkingPhrases.thinking).count == 100)
        #expect(ThinkingPhrases.thinking.count == 100)
        #expect(ThinkingPhrases.thinking.first == RunStatus.thinking.label)
    }
}
