import SwiftUI

/// Marks the runs of a `Text` that are inline code, for `InlineCodeRenderer`.
struct InlineCodeMark: TextAttribute {}

/// Draws a rounded fill behind each stretch of marked runs on a line, then the text over it. The fill reaches
/// `verticalPadding` past the runs; the room at the sides is the spacers the text puts there.
struct InlineCodeRenderer: TextRenderer {
    let verticalPadding: CGFloat
    let cornerRadius: CGFloat
    let fill: Color

    /// Room for a fill reaching past the first or last line.
    var displayPadding: EdgeInsets {
        EdgeInsets(top: verticalPadding, leading: 0, bottom: verticalPadding, trailing: 0)
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        // All fills first, so a fill reaching into the line above stays behind that line's text.
        for line in layout {
            var stretch: CGRect?
            for run in line {
                if run[InlineCodeMark.self] != nil {
                    let bounds = run.typographicBounds.rect
                    stretch = stretch.map { $0.union(bounds) } ?? bounds
                } else if let done = stretch {
                    fill(done, in: &context)
                    stretch = nil
                }
            }
            if let done = stretch { fill(done, in: &context) }
        }
        for line in layout {
            context.draw(line)
        }
    }

    private func fill(_ rect: CGRect, in context: inout GraphicsContext) {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .path(in: rect.insetBy(dx: 0, dy: -verticalPadding))
        context.fill(shape, with: .color(fill))
    }
}
