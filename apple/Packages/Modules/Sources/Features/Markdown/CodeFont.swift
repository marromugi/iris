import CoreText
import SwiftUI

/// JetBrains Mono, without ligatures so code shows the characters it has, bundled with this module under the SIL Open
/// Font License (`Resources/Fonts/JetBrainsMono-OFL.txt`). Japanese falls back to the system font.
nonisolated enum CodeFont {
    /// Code blocks: regular, at the footnote size.
    static func block(size: CGFloat) -> Font {
        _ = registered
        return .custom("JetBrainsMonoNL-Regular", size: size, relativeTo: .footnote)
    }

    /// Inline code: semibold, at `size`, already scaled with the text around it.
    static func inline(size: CGFloat) -> Font {
        _ = registered
        return .custom("JetBrainsMonoNL-SemiBold", fixedSize: size)
    }

    /// How far inline code at `size` advances past `character`, in the code font or, for a character it lacks, the
    /// font the system falls back to.
    static func inlineAdvance(of character: Character, size: CGFloat) -> CGFloat {
        _ = registered
        // A line shapes the character and finds the fallback font as the text does.
        let font = CTFontCreateWithName("JetBrainsMonoNL-SemiBold" as CFString, size, nil)
        let string = NSAttributedString(string: String(character), attributes: [.font: font])
        return CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(string), nil, nil, nil))
    }

    /// Registers the bundled fonts with this process, once.
    private static let registered: Void = {
        let urls = ["JetBrainsMonoNL-Regular", "JetBrainsMonoNL-SemiBold"].compactMap {
            Bundle.module.url(forResource: $0, withExtension: "ttf")
        }
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true, nil)
    }()
}
