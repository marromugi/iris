import SwiftUI

/// The sizes and spacing Markdown is drawn with, in points. Font sizes are at the default Dynamic Type size and scale
/// with it.
nonisolated enum MarkdownStyle {
    static let bodySize: CGFloat = 17
    /// Added to each line's natural height.
    static let lineSpacing: CGFloat = 7
    /// The text's color, a little off black and white so it sits softer on the background. Gray text, such as a
    /// quote's, is drawn from it.
    static func textColor(in scheme: ColorScheme) -> Color {
        scheme == .dark
            ? Color(red: 232 / 255, green: 232 / 255, blue: 235 / 255) : Color(red: 34 / 255, green: 34 / 255, blue: 36 / 255)
    }
    static let tracking: CGFloat = -0.15

    /// Below a paragraph, quote, code block, rule, or table.
    static let blockSpacing: CGFloat = 10
    /// Above and below a list as a whole.
    static let listSpacing: CGFloat = 20
    /// Between two list items in a row.
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
    static let inlineCodeScale: CGFloat = 0.9
    static let inlineCodePadding = (horizontal: CGFloat(5.5), vertical: CGFloat(2))
    static let inlineCodeCornerRadius: CGFloat = 7
    /// Inline code's fill: the system's gray, stronger than its lightest fill so it shows behind a few characters.
    static func inlineCodeFill(in scheme: ColorScheme) -> Color {
        Color(red: 118 / 255, green: 118 / 255, blue: 128 / 255).opacity(scheme == .dark ? 0.36 : 0.2)
    }

    static let tableCellPadding = (horizontal: CGFloat(8), vertical: CGFloat(10))
    static let tableCellWidth: CGFloat = 220
    static let tableCornerRadius: CGFloat = 10

    /// The space above `block` when `previous` comes right before it. Each block has its own space above and below,
    /// and where two meet the larger one wins, as CSS margins collapse; list items in a row are `itemSpacing` apart.
    static func spacing(above block: MarkdownBlock, after previous: MarkdownBlock) -> CGFloat {
        if case .item = block, case .item = previous { return itemSpacing }
        return max(margins(of: previous).below, margins(of: block).above)
    }

    /// The space a block wants above and below it. Other blocks want none above, so the block before decides.
    private static func margins(of block: MarkdownBlock) -> (above: CGFloat, below: CGFloat) {
        switch block {
        case .heading(let level, _):
            switch level {
            case 1: (38, 14)
            case 2: (23, 14)
            default: (28, 9)
            }
        case .item: (listSpacing, listSpacing)
        default: (0, blockSpacing)
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
