import Foundation

/// How much of Markdown that is still being written can be shown without half-written formatting: the text up to the
/// first construct that has begun but not ended, so its brackets, backticks or asterisks never show on their own.
///
/// Held back are a code block whose fence isn't closed, and, in the paragraph being written, inline code, bold and
/// strikethrough not yet closed and a link or image not yet finished. A marker that may be the start of one of these
/// (a trailing backtick, asterisk, tilde, `!` or `[`) waits for the next character. A backslash escapes the character
/// after it. A marker that is never closed shows once its paragraph ends.
enum SettledMarkdown {
    static func prefix(of text: String) -> String {
        let text = text.replacingOccurrences(of: "\r\n", with: "\n")
        var openFence: String.Index?
        var afterClosedFence = text.startIndex
        for line in lines(of: text) {
            if openFence == nil, isOpeningFence(text[line]) {
                openFence = line.lowerBound
            } else if openFence != nil, isClosingFence(text[line]) {
                openFence = nil
                afterClosedFence = line.upperBound < text.endIndex ? text.index(after: line.upperBound) : text.endIndex
            }
        }
        if let openFence { return String(text[..<openFence]) }

        let written = text[afterClosedFence...]
        let paragraph = written.range(of: "\n\n", options: .backwards)?.upperBound ?? afterClosedFence
        let cut = firstUnclosed(in: text[paragraph...]) ?? text.endIndex
        var settled = text[..<cut]
        if settled.endIndex > paragraph {
            while let last = settled.last, "`*~![".contains(last), settled.endIndex > paragraph {
                settled = settled.dropLast()
            }
        }
        return String(settled)
    }

    static func isOpeningFence(_ line: Substring) -> Bool {
        line.trimmingCharacters(in: .whitespaces).hasPrefix("```")
    }

    /// Only backticks, at least three: a fence line with more after it is content of the block.
    static func isClosingFence(_ line: Substring) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.count >= 3 && trimmed.allSatisfy { $0 == "`" }
    }

    /// The ranges of the lines of `text`, without their newlines.
    private static func lines(of text: String) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var start = text.startIndex
        while start < text.endIndex {
            let end = text[start...].firstIndex(of: "\n") ?? text.endIndex
            ranges.append(start..<end)
            start = end < text.endIndex ? text.index(after: end) : text.endIndex
        }
        return ranges
    }

    /// Where the first inline construct that hasn't ended begins, in the paragraph still being written.
    private static func firstUnclosed(in tail: Substring) -> String.Index? {
        var index = tail.startIndex
        var openCode: String.Index?
        var openBold: String.Index?
        var openStrike: String.Index?
        while index < tail.endIndex {
            let rest = tail[index...]
            if rest.hasPrefix("\\") {
                index = tail.index(index, offsetBy: 2, limitedBy: tail.endIndex) ?? tail.endIndex
                continue
            }
            if rest.hasPrefix("`") {
                openCode = openCode == nil ? index : nil
                index = tail.index(after: index)
                continue
            }
            if openCode != nil {
                index = tail.index(after: index)
                continue
            }
            if rest.hasPrefix("**") {
                openBold = openBold == nil ? index : nil
                index = tail.index(index, offsetBy: 2)
                continue
            }
            if rest.hasPrefix("~~") {
                openStrike = openStrike == nil ? index : nil
                index = tail.index(index, offsetBy: 2)
                continue
            }
            if rest.hasPrefix("[") || rest.hasPrefix("![") {
                let start = index
                let open = rest.hasPrefix("!") ? tail.index(after: index) : index
                switch linkEnd(in: tail[open...]) {
                case .ended(let end):
                    index = end
                    continue
                case .unfinished:
                    return [openCode, openBold, openStrike, start].compactMap { $0 }.min()
                case .notALink:
                    break
                }
            }
            index = tail.index(after: index)
        }
        return [openCode, openBold, openStrike].compactMap { $0 }.min()
    }

    private enum LinkEnd {
        case ended(String.Index)
        case unfinished
        case notALink
    }

    /// Whether `text`, starting at `[`, is a link that has ended, one still being written, or no link.
    private static func linkEnd(in text: Substring) -> LinkEnd {
        guard let close = text.firstIndex(where: { $0 == "]" || $0 == "\n" }) else { return .unfinished }
        guard text[close] == "]" else { return .notALink }
        let afterClose = text.index(after: close)
        guard afterClose < text.endIndex else { return .unfinished }
        guard text[afterClose] == "(" else { return .notALink }
        guard let end = text[afterClose...].firstIndex(where: { $0 == ")" || $0 == "\n" }) else { return .unfinished }
        return text[end] == ")" ? .ended(text.index(after: end)) : .notALink
    }
}
