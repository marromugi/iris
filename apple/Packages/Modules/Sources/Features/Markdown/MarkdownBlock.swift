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

    /// The blocks of `text`, in order. A code fence that isn't closed runs to the end.
    static func blocks(of text: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var code: (language: String, lines: [String])?

        func endParagraph() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: "\n"))) }
            paragraph = []
        }
        func endQuote() {
            if !quote.isEmpty { blocks.append(.quote(quote.joined(separator: "\n"))) }
            quote = []
        }

        for line in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if var open = code {
                if trimmed.hasPrefix("```") {
                    blocks.append(.code(language: open.language, text: open.lines.joined(separator: "\n")))
                    code = nil
                } else {
                    open.lines.append(line)
                    code = open
                }
                continue
            }
            if trimmed.hasPrefix("```") {
                endParagraph()
                endQuote()
                code = (String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces), [])
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
            } else if let item = Self.item(line) {
                endParagraph()
                blocks.append(item)
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
