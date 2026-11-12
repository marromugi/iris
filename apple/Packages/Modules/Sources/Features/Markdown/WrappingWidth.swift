import SwiftUI

/// Lays out its one view at its own width, but no wider than `maxWidth`, and wraps it there. Unlike
/// `frame(maxWidth:)`, it measures the height at the width the view wraps to, even when it is given no width, as in a
/// view that sizes to its content.
nonisolated struct WrappingWidth: Layout {
    let maxWidth: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let view = subviews.first else { return .zero }
        return view.sizeThatFits(ProposedViewSize(width: width(of: view, in: proposal), height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }

    private func width(of view: LayoutSubview, in proposal: ProposedViewSize) -> CGFloat {
        min(view.sizeThatFits(.unspecified).width, maxWidth, proposal.width ?? .infinity)
    }
}
