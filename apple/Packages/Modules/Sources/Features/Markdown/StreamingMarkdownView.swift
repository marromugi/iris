import SwiftUI

/// Markdown still being written: only what has settled shows (`SettledMarkdown`), so half-written formatting never
/// does, and each new part fades in over `fadeIn` once it can show. With Reduce Motion new parts show at once.
struct StreamingMarkdownView: View {
    let text: String

    static let fadeIn = 0.35

    /// How long the settled text was, and when it reached that length; the latest last. The first is the last one
    /// done fading, or nothing at all, so the first part fades in too.
    @State private var reveals: [Reveal] = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    struct Reveal: Equatable {
        let length: Int
        let at: Date
    }

    var body: some View {
        let settled = SettledMarkdown.prefix(of: text)
        let blocks = MarkdownBlock.blocks(of: settled)
        TimelineView(.animation(paused: reduceMotion)) { timeline in
            MarkdownView(
                blocks: blocks,
                fadingTail: reduceMotion ? [] : Self.fadingTail(of: reveals, at: timeline.date))
        }
        .animation(reduceMotion ? nil : .easeIn(duration: Self.fadeIn), value: blocks.count)
        // The time each part came in is kept only to fade it; it follows the settled length, which nothing else
        // tells the view when it grew.
        .onChange(of: settled.count, initial: true) { _, length in
            let now = Date()
            let fading = reveals.filter { now.timeIntervalSince($0.at) < Self.fadeIn }
            let shown = reveals.last { now.timeIntervalSince($0.at) >= Self.fadeIn } ?? Reveal(length: 0, at: .distantPast)
            reveals = [shown] + fading + [Reveal(length: length, at: now)]
        }
    }

    /// The parts that are still fading in at `now`, as characters at the end of the text, newest last.
    static func fadingTail(of reveals: [Reveal], at now: Date) -> [FadingText] {
        zip([nil] + reveals.map(Optional.some), reveals).compactMap { before, reveal in
            let age = now.timeIntervalSince(reveal.at)
            guard let before, age < fadeIn, reveal.length > before.length else { return nil }
            return FadingText(characters: reveal.length - before.length, opacity: max(0, age / fadeIn))
        }
    }
}
