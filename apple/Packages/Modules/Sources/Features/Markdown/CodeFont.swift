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
        let string = String(character)
        let base = CTFontCreateWithName("JetBrainsMonoNL-SemiBold" as CFString, size, nil)
        let font = CTFontCreateForString(base, string as CFString, CFRange(location: 0, length: string.utf16.count))
        var characters = Array(string.utf16)
        var glyphs = [CGGlyph](repeating: 0, count: characters.count)
        CTFontGetGlyphsForCharacters(font, &characters, &glyphs, characters.count)
        return CTFontGetAdvancesForGlyphs(font, .horizontal, &glyphs, nil, glyphs.count)
    }

    /// Registers the bundled fonts with this process, once.
    private static let registered: Void = {
        let urls = ["JetBrainsMonoNL-Regular", "JetBrainsMonoNL-SemiBold"].compactMap {
            Bundle.module.url(forResource: $0, withExtension: "ttf")
        }
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true, nil)
    }()
}
