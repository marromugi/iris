#if DEBUG
    import CoreGraphics
    import Foundation
    import ImageIO
    import UniformTypeIdentifiers

    nonisolated extension Samples {
        /// A PNG of `width` by `height` pixels: a gradient from `from` to `to`, top left to bottom right, as RGB from 0
        /// to 1.
        static func photo(
            width: Int, height: Int, from: (Double, Double, Double) = (0.95, 0.6, 0.4),
            to: (Double, Double, Double) = (0.3, 0.4, 0.85)
        ) -> Data {
            let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
            guard
                let context = CGContext(
                    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
                let gradient = CGGradient(
                    colorsSpace: space,
                    colors: [
                        CGColor(srgbRed: from.0, green: from.1, blue: from.2, alpha: 1),
                        CGColor(srgbRed: to.0, green: to.1, blue: to.2, alpha: 1),
                    ] as CFArray, locations: nil)
            else { preconditionFailure("A sample photo can be drawn") }
            context.drawLinearGradient(
                gradient, start: CGPoint(x: 0, y: height), end: CGPoint(x: width, y: 0), options: [])
            let png = NSMutableData()
            guard let image = context.makeImage(),
                let destination = CGImageDestinationCreateWithData(png, UTType.png.identifier as CFString, 1, nil)
            else { preconditionFailure("A sample photo can be written") }
            CGImageDestinationAddImage(destination, image, nil)
            guard CGImageDestinationFinalize(destination) else { preconditionFailure("A sample photo can be written") }
            return png as Data
        }
    }
#endif
