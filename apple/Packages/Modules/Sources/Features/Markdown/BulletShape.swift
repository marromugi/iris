import SwiftUI

/// The swirl a bulleted list item starts with, drawn in a 13 × 11 box and scaled to its frame. Stroke it.
nonisolated struct BulletShape: Shape {
    static let aspectRatio: CGFloat = 13 / 11

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 12, y: 5.04609))
        path.addCurve(
            to: CGPoint(x: 5.22986, y: 9.99951), control1: CGPoint(x: 12, y: 5.04609),
            control2: CGPoint(x: 11.0109, y: 9.99949))
        path.addCurve(
            to: CGPoint(x: 1.69238, y: 3.16368), control1: CGPoint(x: 1.27073, y: 9.99952),
            control2: CGPoint(x: 0.0892287, y: 5.72989))
        path.addCurve(
            to: CGPoint(x: 8.14542, y: 2.07389), control1: CGPoint(x: 3.04356, y: 1.0008),
            control2: CGPoint(x: 6.3754, y: 0.143935))
        path.addCurve(
            to: CGPoint(x: 4.38594, y: 5.47896), control1: CGPoint(x: 10.4169, y: 4.55064),
            control2: CGPoint(x: 6.58594, y: 8.52308))
        return path.applying(
            CGAffineTransform(translationX: rect.minX, y: rect.minY).scaledBy(x: rect.width / 13, y: rect.height / 11))
    }
}
