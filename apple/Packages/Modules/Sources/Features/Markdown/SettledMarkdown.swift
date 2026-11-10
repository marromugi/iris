/// How much of Markdown that is still being written can be shown without half-written formatting: the text up to
/// the first construct that has begun but not ended, so its brackets, backticks or asterisks never show on their own.
/// The constructs held back are a code block whose fence isn't closed, inline code, bold and strikethrough not yet
/// closed, and a link or image not yet finished.
enum SettledMarkdown {
    static func prefix(of text: String) -> String {
        let settledBlocks = closedFencePrefix(of: text)
        let lastParagraphStart = settledBlocks.range(of: "\n\n", options: .backwards)?.upperBound ?? settledBlocks.startIndex
        let tail = settledBlocks[lastParagraphStart...]
        guard let cut = firstUnclosed(in: tail) else { return settledBlocks }
        return String(settledBlocks[..<cut])
    }

    /// The text up to a code fence that isn't closed yet.
    private static func closedFencePrefix(of text: String) -> String {
        var openFence: String.Index?
        var lineStart = text.startIndex
        while lineStart < text.endIndex {
            let lineEnd = text[lineStart...].firstIndex(of: "\n") ?? text.endIndex
            if text[lineStart..<lineEnd].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                openFence = openFence == nil ? lineStart : nil
            }
            lineStart = lineEnd < text.endIndex ? text.index(after: lineEnd) : text.endIndex
        }
        return openFence.map { String(text[..<$0]) } ?? text
    }

    /// Where the first inline construct that hasn't ended begins, in the paragraph still being written.
    private static func firstUnclosed(in tail: Substring) -> String.Index? {
        var index = tail.startIndex
        var openCode: String.Index?
        var openBold: String.Index?
        var openStrike: String.Index?
        while index < tail.endIndex {
            let rest = tail[index...]
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
        guard let close = text.firstIndex(of: "]") else {
            return text.contains("\n") ? .notALink : .unfinished
        }
        let afterClose = text.index(after: close)
        guard afterClose < text.endIndex else { return .unfinished }
        guard text[afterClose] == "(" else { return .notALink }
        guard let end = text[afterClose...].firstIndex(of: ")") else { return .unfinished }
        return .ended(text.index(after: end))
    }
}
