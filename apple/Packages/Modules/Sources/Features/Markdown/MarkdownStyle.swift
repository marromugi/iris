import CoreGraphics

/// The sizes and spacing Markdown is drawn with, in points. Font sizes are at the default Dynamic Type size and scale
/// with it.
nonisolated enum MarkdownStyle {
    static let bodySize: CGFloat = 17
    /// Added to each line's natural height.
    static let lineSpacing: CGFloat = 7
    static let tracking: CGFloat = -0.15

    static let blockSpacing: CGFloat = 14
    /// Between two list items in a row; other blocks are `blockSpacing` apart.
    static let itemSpacing: CGFloat = 10

    static let markerSpacing: CGFloat = 7
    static let bulletWidth: CGFloat = 14.5
    static let listIndent: CGFloat = 16

    static let quoteLineWidth: CGFloat = 3.5
    /// Between the widest the wave swings and the text.
    static let quoteSpacing: CGFloat = 13
    static let quoteWave = Wave(amplitude: 1, length: 12, randomness: 0.4, seed: 7)

    static let codePadding: CGFloat = 14
    static let codeCornerRadius: CGFloat = 16

    /// Inline code's size against the text around it.
    static let inlineCodeScale: CGFloat = 1.05
    static let inlineCodePadding = (horizontal: CGFloat(5.5), vertical: CGFloat(2))
    static let inlineCodeCornerRadius: CGFloat = 7

    static let tableCellPadding = (horizontal: CGFloat(8), vertical: CGFloat(10))
    static let tableCellWidth: CGFloat = 220
    static let tableCornerRadius: CGFloat = 10

    /// The space above `block` when `previous` comes right before it: a heading adds its own space above, and
    /// takes away or adds its own below.
    static func spacing(above block: MarkdownBlock, after previous: MarkdownBlock) -> CGFloat {
        var spacing: CGFloat
        if case .item = block, case .item = previous {
            spacing = itemSpacing
        } else {
            spacing = blockSpacing
        }
        if case .heading(let level, _) = block { spacing += headingSpacing(level).above }
        if case .heading(let level, _) = previous { spacing += headingSpacing(level).below }
        return max(spacing, 0)
    }

    /// What a heading of `level` adds above and below it; the levels past 3 share level 3's.
    private static func headingSpacing(_ level: Int) -> (above: CGFloat, below: CGFloat) {
        switch level {
        case 1: (24, 0)
        case 2: (9, 0)
        default: (14, -5)
        }
    }

    /// A wavy line: how far it swings to each side, how long one wave is, how much each half wave's swing and
    /// length vary (0 is even), and the seed that picks the variation, so the same seed draws the same line.
    struct Wave {
        let amplitude: CGFloat
        let length: CGFloat
        let randomness: CGFloat
        let seed: UInt32

        /// The width the line needs at its widest swing.
        func width(lineWidth: CGFloat) -> CGFloat {
            2 * amplitude * (1 + randomness) + lineWidth
        }
    }
}
