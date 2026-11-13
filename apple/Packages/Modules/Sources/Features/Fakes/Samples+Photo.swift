#if DEBUG
    import Backend
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

        /// A JPEG kept `width` by `height` pixels whose EXIF says to turn it a quarter clockwise to show it, as a phone
        /// held upright saves one.
        static func turnedPhoto(width: Int, height: Int) -> Data {
            guard let source = CGImageSourceCreateWithData(photo(width: width, height: height) as CFData, nil),
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { preconditionFailure("A sample photo can be read") }
            let jpeg = NSMutableData()
            guard
                let destination = CGImageDestinationCreateWithData(jpeg, UTType.jpeg.identifier as CFString, 1, nil)
            else { preconditionFailure("A sample photo can be written") }
            CGImageDestinationAddImage(
                destination, image, [kCGImagePropertyOrientation: CGImagePropertyOrientation.right.rawValue] as CFDictionary)
            guard CGImageDestinationFinalize(destination) else { preconditionFailure("A sample photo can be written") }
            return jpeg as Data
        }

        /// Images posts carry, as the server lists them, and their bytes: wide, tall, and square, then one that is gone.
        static let pictures: [Attachment] = [
            Attachment(id: "picture-wide", mediaType: "image/png", size: 0),
            Attachment(id: "picture-tall", mediaType: "image/png", size: 0),
            Attachment(id: "picture-square", mediaType: "image/png", size: 0),
            Attachment(id: "picture-gone", mediaType: "image/jpeg", size: 0),
        ]
        static let pictureBytes: [Attachment.ID: Data] = [
            "picture-wide": photo(width: 1568, height: 1045),
            "picture-tall": photo(width: 882, height: 1568, from: (0.4, 0.75, 0.5), to: (0.1, 0.2, 0.45)),
            "picture-square": photo(width: 1200, height: 1200, from: (0.9, 0.85, 0.4), to: (0.7, 0.3, 0.5)),
        ]

        /// A post of the user's that carries `count` of the pictures, with `text`.
        static func picturePost(_ count: Int, text: String = "") -> Post {
            Post(
                id: "picture-post-\(count)", agentId: nil, text: text, attachments: Array(pictures.prefix(count)),
                createdAt: moment("2026-11-10T08:00:00Z"))
        }
    }
#endif
