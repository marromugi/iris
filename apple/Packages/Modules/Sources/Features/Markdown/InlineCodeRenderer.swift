import SwiftUI

/// Marks the runs of a `Text` that are inline code, for `InlineCodeRenderer`. The code's last character carries how far
/// it advances by itself, without the room after it.
struct InlineCodeMark: TextAttribute {
    var endAdvance: CGFloat?
}

/// Draws a rounded fill behind each stretch of marked runs on a line, then the text over it. The text gives a stretch
/// room for both its sides after its last character; on the line where a stretch starts, the renderer draws it
/// `padding.horizontal` to the right, so the room is split between its sides. The fill reaches `padding.vertical` above
/// and below.
struct InlineCodeRenderer: TextRenderer {
    let padding: (horizontal: CGFloat, vertical: CGFloat)
    let cornerRadius: CGFloat
    let fill: Color

    /// Room for a fill reaching past the first or last line, and for code that wraps, drawn to the right of its line.
    var displayPadding: EdgeInsets {
        EdgeInsets(top: padding.vertical, leading: 0, bottom: padding.vertical, trailing: padding.horizontal)
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        let lines = layout.map { Array($0) }
        let stretches = lines.indices.map { Self.stretches(in: lines, at: $0) }
        // All fills first, so a fill reaching into the line above stays behind that line's text.
        for (lineIndex, line) in lines.enumerated() {
            for stretch in stretches[lineIndex] {
                let bounds = line[stretch.runs].map(fillBounds).reduce(CGRect.null) { $0.union($1) }
                var area = bounds.insetBy(dx: 0, dy: -padding.vertical)
                // Code that wraps has no room at its end on this line; cover it drawn to the right.
                if stretch.isShifted && stretch.wraps { area.size.width += padding.horizontal * 2 }
                // Code going on from the line above is drawn where it is, so it needs only the room after it.
                if !stretch.isShifted && !stretch.wraps { area.size.width -= padding.horizontal }
                context.fill(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).path(in: area), with: .color(fill))
            }
        }
        for (lineIndex, line) in lines.enumerated() {
            let shifted = Set(stretches[lineIndex].filter(\.isShifted).flatMap(\.runs))
            for (index, run) in line.enumerated() {
                if shifted.contains(index) {
                    var moved = context
                    moved.translateBy(x: padding.horizontal, y: 0)
                    moved.draw(run)
                } else {
                    context.draw(run)
                }
            }
        }
    }

    /// A run's part of the fill. The code's last character ends its own advance plus the room after it: its bounds can
    /// hold more, such as the space Japanese punctuation right before the code gives up.
    private func fillBounds(_ run: Text.Layout.Run) -> CGRect {
        let bounds = run.typographicBounds.rect
        guard let advance = run[InlineCodeMark.self]?.endAdvance else { return bounds }
        return CGRect(
            x: bounds.minX, y: bounds.minY, width: min(bounds.width, advance + padding.horizontal * 2),
            height: bounds.height)
    }

    /// A stretch of marked runs on one line: which runs, whether it starts there (and so is drawn to the right), and
    /// whether it goes on at the start of the next line.
    private struct Stretch {
        let runs: Range<Int>
        let isShifted: Bool
        let wraps: Bool
    }

    private static func stretches(in lines: [[Text.Layout.Run]], at lineIndex: Int) -> [Stretch] {
        let line = lines[lineIndex]
        func isCode(_ line: [Text.Layout.Run], _ index: Int) -> Bool {
            line.indices.contains(index) && line[index][InlineCodeMark.self] != nil
        }
        let goesOnFromAbove = lineIndex > 0 && isCode(lines[lineIndex - 1], lines[lineIndex - 1].count - 1)
        let goesOnBelow = lines.indices.contains(lineIndex + 1) && isCode(lines[lineIndex + 1], 0)
        var result: [Stretch] = []
        var index = 0
        while index < line.count {
            guard isCode(line, index) else {
                index += 1
                continue
            }
            let start = index
            while isCode(line, index) { index += 1 }
            result.append(
                Stretch(
                    runs: start..<index, isShifted: !(start == 0 && goesOnFromAbove),
                    wraps: index == line.count && goesOnBelow))
        }
        return result
    }
}
