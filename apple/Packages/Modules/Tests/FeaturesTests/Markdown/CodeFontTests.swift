import CoreText
import Testing

@testable import Features

struct CodeFontTests {
    @Test func loadsTheBundledCodeFonts() {
        _ = CodeFont.block(size: 13)
        for name in ["JetBrainsMonoNL-Regular", "JetBrainsMonoNL-SemiBold"] {
            // CoreText hands back another font when the name isn't registered.
            #expect(CTFontCopyPostScriptName(CTFontCreateWithName(name as CFString, 13, nil)) as String == name)
        }
    }

    @Test func measuresInlineCodeByTheFontThatDrawsEachCharacter() {
        // JetBrains Mono is 600 units to the em; Japanese falls back to a font a full em wide.
        #expect(abs(CodeFont.inlineAdvance(of: "a", size: 10) - 6) < 0.01)
        #expect(abs(CodeFont.inlineAdvance(of: "書", size: 10) - 10) < 0.5)
    }
}
