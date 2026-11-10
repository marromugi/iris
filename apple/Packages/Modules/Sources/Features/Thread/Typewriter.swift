/// Phrases typed out and backspaced one after another, as on a keyboard: what shows a given time after it starts. Each
/// phrase is typed a character at a time, held, deleted a character at a time, and the next starts; after the last,
/// the first comes again.
struct Typewriter: Equatable {
    let phrases: [String]
    var typeEach: Duration = .milliseconds(90)
    var deleteEach: Duration = .milliseconds(40)
    var holdTyped: Duration = .milliseconds(1600)
    var holdDeleted: Duration = .milliseconds(300)

    /// The text showing `elapsed` after the first phrase starts.
    func text(after elapsed: Duration) -> String {
        let cycle = phrases.reduce(Duration.zero) { $0 + length(of: $1) }
        guard cycle > .zero else { return "" }
        var left = Duration.nanoseconds(elapsed.nanoseconds % cycle.nanoseconds)
        for phrase in phrases {
            let length = length(of: phrase)
            if left < length { return text(of: phrase, after: left) }
            left -= length
        }
        return ""
    }

    private func length(of phrase: String) -> Duration {
        typeEach * phrase.count + holdTyped + deleteEach * phrase.count + holdDeleted
    }

    private func text(of phrase: String, after elapsed: Duration) -> String {
        let typing = typeEach * phrase.count
        if elapsed < typing { return String(phrase.prefix(Int(elapsed.nanoseconds / typeEach.nanoseconds))) }
        let deletingFrom = typing + holdTyped
        if elapsed < deletingFrom { return phrase }
        let deleting = deleteEach * phrase.count
        if elapsed < deletingFrom + deleting {
            let deleted = Int((elapsed - deletingFrom).nanoseconds / deleteEach.nanoseconds)
            return String(phrase.prefix(phrase.count - deleted))
        }
        return ""
    }
}

extension Duration {
    fileprivate var nanoseconds: Int64 {
        components.seconds * 1_000_000_000 + components.attoseconds / 1_000_000_000
    }
}
