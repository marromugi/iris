import SwiftUI

/// A line down the middle of its frame that waves from side to side, each half wave a little different, the same
/// way every time for the same `wave`. Its ends are `inset` in from the top and bottom, so round caps stay inside.
nonisolated struct WavyLine: Shape {
    let wave: MarkdownStyle.Wave
    let inset: CGFloat

    func path(in rect: CGRect) -> Path {
        var random = SeededRandom(seed: wave.seed &* 7919 &+ 1)
        func jitter() -> CGFloat { CGFloat(random.next() * 2 - 1) * wave.randomness }

        var path = Path()
        let end = rect.maxY - inset
        var top = rect.minY + inset
        var side: CGFloat = 1
        path.move(to: CGPoint(x: rect.midX, y: top))
        while top < end {
            let half = max(2, wave.length / 2 * (1 + jitter() * 0.6))
            let amplitude = wave.amplitude * (1 + jitter())
            var y = top
            while y < min(top + half, end) {
                y = min(y + 0.5, top + half, end)
                let x = rect.midX + side * amplitude * sin(.pi * (y - top) / half)
                path.addLine(to: CGPoint(x: x, y: y))
            }
            top += half
            side = -side
        }
        return path
    }
}

/// Mulberry32: small, fast, and the same numbers on every device for the same seed.
private nonisolated struct SeededRandom {
    var state: UInt32

    init(seed: UInt32) { state = seed }

    /// A number in 0..<1.
    mutating func next() -> Double {
        state &+= 0x6D2B_79F5
        var t = state
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }
}
