import Foundation
import SwiftUI

/// Markdown drawn as blocks: headings, paragraphs, list items, quotes, code, rules, and tables, with emphasis, inline
/// code and links inside them. `fadingTail` gives the opacity of the last characters of the last block's text, newest last, so
/// text that just came in fades in; a code block or rule fades as a whole.
struct MarkdownView: View {
    let blocks: [MarkdownBlock]
    var fadingTail: [FadingText] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Blocks only grow at the end, so their place is their identity.
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                MarkdownBlockView(block: block, fadingTail: index == blocks.count - 1 ? fadingTail : [])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

/// Characters at the end of a text, and how opaque they show.
struct FadingText: Equatable {
    let characters: Int
    let opacity: Double
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let fadingTail: [FadingText]

    var body: some View {
        switch block {
        case .heading(let level, let text):
            InlineText(text: text, style: .primary, fadingTail: fadingTail)
                .font(level == 1 ? .title3.bold() : level == 2 ? .headline : .subheadline.bold())
        case .paragraph(let text):
            InlineText(text: text, style: .primary, fadingTail: fadingTail)
        case .item(let marker, let depth, let text):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(marker).foregroundStyle(.secondary)
                InlineText(text: text, style: .primary, fadingTail: fadingTail)
            }
            .padding(.leading, CGFloat(depth) * 16)
        case .quote(let text):
            InlineText(text: text, style: .secondary, fadingTail: fadingTail)
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    Capsule().fill(.separator).frame(width: 3)
                }
        case .code(_, let text):
            ScrollView(.horizontal) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .padding(12)
            }
            .background(.fill.tertiary, in: .rect(cornerRadius: 10))
            .opacity(fadingTail.first?.opacity ?? 1)
        case .rule:
            Divider()
                .opacity(fadingTail.first?.opacity ?? 1)
        case .table(let header, let rows):
            // Not faded: a table grows a row at a time, and fading it whole would make it blink with each.
            TableView(header: header, rows: rows)
        }
    }
}

/// A table: the header in bold over a line, then the rows, each cell with its inline Markdown, wrapping past
/// `cellWidth`. It scrolls sideways when it is wider than the screen. VoiceOver reads each cell after its column's
/// name.
private struct TableView: View {
    let header: [String]
    let rows: [[String]]

    @ScaledMetric private var cellWidth: CGFloat = 220

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                GridRow {
                    ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                        cellView(cell)
                            .bold()
                            .accessibilityAddTraits(.isHeader)
                    }
                }
                Divider()
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                            cellView(cell)
                                .accessibilityLabel(
                                    "\(Self.plain(header.indices.contains(column) ? header[column] : "")): \(Self.plain(cell))")
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .font(.subheadline)
            .padding(.vertical, 4)
        }
    }

    private func cellView(_ text: String) -> some View {
        InlineText(text: text, style: .primary, fadingTail: [])
            .frame(maxWidth: cellWidth, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A cell's text without its inline Markdown, for VoiceOver.
    private static func plain(_ text: String) -> String {
        String(InlineText.attributed(text).characters)
    }
}

/// A block's text with its inline Markdown, in `style`, the fading tail drawn with its own opacities.
private struct InlineText: View {
    let text: String
    let style: HierarchicalShapeStyle
    let fadingTail: [FadingText]

    var body: some View {
        var rest = text
        var pieces: [(String, Double)] = []
        for fading in fadingTail.reversed() {
            let count = min(fading.characters, rest.count)
            pieces.insert((String(rest.suffix(count)), fading.opacity), at: 0)
            rest = String(rest.dropLast(count))
        }
        return pieces.reduce(Text(Self.attributed(rest)).foregroundStyle(style)) { shown, piece in
            Text("\(shown)\(Text(Self.attributed(piece.0)).foregroundStyle(style.opacity(piece.1)))")
        }
    }

    /// The text with its inline Markdown read, or as it is when it doesn't read.
    static func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}

#if DEBUG
    #Preview {
        ScrollView {
            MarkdownView(
                blocks: MarkdownBlock.blocks(
                    of: """
                        ## 今日やること
                        返信が要りそうなのは **2 件** です。詳しくは[メール](https://example.com)を。

                        1. 打ち合わせの日程を返す
                        2. 請求書を確かめる
                           - 金曜まで

                        > 急ぎは請求書のほうです。

                        ```
                        件名: Re: 来週の打ち合わせ
                        ```

                        | 件名 | 期限 | 急ぎ |
                        |:--|:--:|--:|
                        | 来週の打ち合わせ | 水曜 | |
                        | 請求書の確認 | **金曜** | ✓ |
                        """)
            )
            .padding()
        }
    }
#endif
