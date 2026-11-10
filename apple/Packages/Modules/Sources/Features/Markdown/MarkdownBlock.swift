import Foundation

/// One block of Markdown as the app draws it. Text inside a block keeps its inline Markdown (emphasis, code, links),
/// which the view reads; a code block's text is shown as it is.
enum MarkdownBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    /// A list item: its marker as shown ("•" or "1."), how deep it is nested, and its text.
    case item(marker: String, depth: Int, text: String)
    case quote(String)
    case code(language: String, text: String)
    case rule

    /// The text the block shows, apart from its marker; a rule shows none.
    var text: String {
        switch self {
        case .heading(_, let text), .paragraph(let text), .item(_, _, let text), .quote(let text), .code(_, let text):
            text
        case .rule:
            ""
        }
    }

    /// The blocks of `text`, in order. A code fence that isn't closed runs to the end. An indented line right after
    /// a list item continues that item.
    static func blocks(of text: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var code: (language: String, indent: Int, lines: [String])?

        func endParagraph() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            paragraph = []
        }
        func endQuote() {
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))) }
            quote = []
        }

        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\t", with: "  ")
        for line in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let indent = line.prefix { $0 == " " }.count
            if var open = code {
                if SettledMarkdown.isClosingFence(line) {
                    blocks.append(.code(language: open.language, text: open.lines.joined(separator: "\n")))
                    code = nil
                } else {
                    // Inside a list item the fence is indented, and so is its code; the code shows without it.
                    open.lines.append(String(line.dropFirst(min(open.indent, indent))))
                    code = open
                }
                continue
            }
            if SettledMarkdown.isOpeningFence(line) {
                endParagraph()
                endQuote()
                code = (String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces), indent, [])
                continue
            }
            if trimmed.hasPrefix(">") {
                endParagraph()
                quote.append(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces))
                continue
            }
            endQuote()
            if trimmed.isEmpty {
                endParagraph()
            } else if let heading = Self.heading(trimmed) {
                endParagraph()
                blocks.append(heading)
            } else if ["---", "***", "___"].contains(trimmed) {
                endParagraph()
                blocks.append(.rule)
            } else if let item = Self.item(String(line)) {
                endParagraph()
                blocks.append(item)
            } else if indent > 0, paragraph.isEmpty, case .item(let marker, let depth, let itemText)? = blocks.last {
                blocks[blocks.count - 1] = .item(marker: marker, depth: depth, text: itemText + "\n" + trimmed)
            } else {
                paragraph.append(trimmed)
            }
        }
        if let open = code { blocks.append(.code(language: open.language, text: open.lines.joined(separator: "\n"))) }
        endParagraph()
        endQuote()
        return blocks
    }

    private static func heading(_ line: String) -> MarkdownBlock? {
        let hashes = line.prefix { $0 == "#" }.count
        guard (1...6).contains(hashes), line.dropFirst(hashes).first == " " else { return nil }
        return .heading(level: hashes, text: String(line.dropFirst(hashes + 1)).trimmingCharacters(in: .whitespaces))
    }

    private static func item(_ line: String) -> MarkdownBlock? {
        let indent = line.prefix { $0 == " " }.count
        let rest = line.dropFirst(indent)
        let depth = indent / 2
        for bullet in ["- ", "* ", "+ "] where rest.hasPrefix(bullet) {
            return .item(marker: "•", depth: depth, text: String(rest.dropFirst(2)))
        }
        let digits = rest.prefix { $0.isNumber }
        if !digits.isEmpty, rest.dropFirst(digits.count).hasPrefix(". ") {
            return .item(marker: "\(digits).", depth: depth, text: String(rest.dropFirst(digits.count + 2)))
        }
        return nil
    }
}
