/// Phrases shown one at a time, each fading in, staying, and fading out, and changed only while nothing shows: what
/// shows a given time after it starts, and how strongly. The first phrase comes first; the rest follow in a scattered
/// order that shows every phrase before any comes again.
struct PhraseFader: Equatable {
    let phrases: [String]
    var fade: Duration = .milliseconds(600)
    var hold: Duration = .seconds(4)

    /// The phrase showing `elapsed` after the first starts fading in, and its opacity from 0 to 1.
    func frame(after elapsed: Duration) -> (text: String, opacity: Double) {
        let cycle = fade + hold + fade
        guard !phrases.isEmpty, cycle > .zero, elapsed >= .zero else { return ("", 0) }
        let turn = Int(elapsed / cycle)
        let into = elapsed - cycle * turn
        let opacity: Double =
            if into < fade {
                into / fade
            } else if into < fade + hold {
                1
            } else {
                1 - (into - fade - hold) / fade
            }
        return (phrase(at: turn), opacity)
    }

    /// The phrase of the `turn`th showing: steps of a stride that shares no factor with the count, so each comes once
    /// per round, and that isn't one step either way, so the order scatters. Too few phrases for such a stride go in
    /// order.
    func phrase(at turn: Int) -> String {
        let count = phrases.count
        guard count > 0, turn >= 0 else { return "" }
        let stride =
            [37, 31, 29, 23, 19, 17, 13, 11, 7, 5, 3].first { prime in
                count % prime != 0 && prime % count != 1 && prime % count != count - 1
            } ?? 1
        return phrases[(turn % count) * stride % count]
    }
}
