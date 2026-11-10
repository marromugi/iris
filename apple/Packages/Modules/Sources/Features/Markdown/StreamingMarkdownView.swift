import SwiftUI

/// Markdown still being written: only what has settled shows (`SettledMarkdown`), so half-written formatting never
/// does, and each new part fades in over `fadeIn` once it can show, a new block whole. With Reduce Motion new parts
/// show at once.
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
        let fading = !reduceMotion && reveals.contains { Date().timeIntervalSince($0.at) < Self.fadeIn }
        TimelineView(.animation(paused: !fading && !reveals.isEmpty)) { timeline in
            MarkdownView(
                blocks: blocks,
                fadingTail: reduceMotion ? [] : Self.fadingTail(of: reveals, in: settled, at: timeline.date))
        }
        // The time each part came in is kept only to fade it; it follows the settled length, which nothing else
        // tells the view when it grew.
        .onChange(of: settled.count, initial: true) { _, length in
            let now = Date()
            let young = reveals.filter { now.timeIntervalSince($0.at) < Self.fadeIn }
            let shown = reveals.last { now.timeIntervalSince($0.at) >= Self.fadeIn } ?? Reveal(length: 0, at: .distantPast)
            reveals = [shown] + young + [Reveal(length: length, at: now)]
        }
    }

    /// The parts of the last block of `settled` still fading in at `now`, as characters at the end of its text, newest
    /// last. Counted in the block's own text, so markers and line breaks don't shift them. Before anything is
    /// recorded, everything waits to fade in.
    static func fadingTail(of reveals: [Reveal], in settled: String, at now: Date) -> [FadingText] {
        let blocks = MarkdownBlock.blocks(of: settled)
        guard let last = blocks.last else { return [] }
        guard !reveals.isEmpty else { return [FadingText(characters: last.text.count, opacity: 0)] }
        // How much of the last block's text there was when the settled text was `length` long.
        func shownOfLast(at length: Int) -> Int {
            let then = MarkdownBlock.blocks(of: String(settled.prefix(length)))
            return then.count == blocks.count ? then.last?.text.count ?? 0 : 0
        }
        return zip(reveals, reveals.dropFirst()).compactMap { before, reveal in
            let age = now.timeIntervalSince(reveal.at)
            let fresh = shownOfLast(at: reveal.length) - shownOfLast(at: before.length)
            guard age < fadeIn, fresh > 0 else { return nil }
            return FadingText(characters: fresh, opacity: max(0, age / fadeIn))
        }
    }
}
