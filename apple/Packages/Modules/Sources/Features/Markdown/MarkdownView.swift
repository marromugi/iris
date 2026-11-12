import Foundation
import SwiftUI

/// Markdown drawn as blocks: headings, paragraphs, list items, quotes, code, rules, and tables, with emphasis, inline
/// code and links inside them, sized and spaced by `MarkdownStyle`. `fadingTail` gives the opacity of the last
/// characters of the last block's text, newest last, so text that just came in fades in; a code block or rule fades as
/// a whole.
struct MarkdownView: View {
    let blocks: [MarkdownBlock]
    var fadingTail: [FadingText] = []

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Blocks only grow at the end, so their place is their identity.
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                MarkdownBlockView(block: block, fadingTail: index == blocks.count - 1 ? fadingTail : [])
                    .padding(.top, index == 0 ? 0 : MarkdownStyle.spacing(above: block, after: blocks[index - 1]))
            }
        }
        .foregroundStyle(MarkdownStyle.textColor(in: colorScheme))
        .lineSpacing(MarkdownStyle.lineSpacing)
        .tracking(MarkdownStyle.tracking)
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

    @ScaledMetric(relativeTo: .body) private var bodySize = MarkdownStyle.bodySize
    @ScaledMetric(relativeTo: .title3) private var title1Size: CGFloat = 20
    @ScaledMetric(relativeTo: .headline) private var title2Size: CGFloat = 17
    @ScaledMetric(relativeTo: .subheadline) private var title3Size: CGFloat = 15
    @ScaledMetric(relativeTo: .footnote) private var tableSize: CGFloat = 13

    var body: some View {
        switch block {
        case .heading(let level, let text):
            let (size, weight): (CGFloat, Font.Weight) =
                switch level {
                case 1: (title1Size, .bold)
                case 2: (title2Size, .semibold)
                default: (title3Size, .bold)
                }
            InlineText(text: text, style: .primary, fadingTail: fadingTail, size: size)
                .font(.system(size: size, weight: weight))
        case .paragraph(let text):
            InlineText(text: text, style: .primary, fadingTail: fadingTail, size: bodySize)
                .font(.system(size: bodySize))
        case .item(let marker, let depth, let text):
            HStack(alignment: .firstTextBaseline, spacing: MarkdownStyle.markerSpacing) {
                ListMarker(marker: marker, textSize: bodySize)
                InlineText(text: text, style: .primary, fadingTail: fadingTail, size: bodySize)
            }
            .font(.system(size: bodySize))
            .padding(.leading, CGFloat(depth) * MarkdownStyle.listIndent)
        case .quote(let text):
            let wave = MarkdownStyle.quoteWave
            let lineWidth = MarkdownStyle.quoteLineWidth
            InlineText(text: text, style: .secondary, fadingTail: fadingTail, size: bodySize)
                .font(.system(size: bodySize))
                .padding(.leading, wave.width(lineWidth: lineWidth) + MarkdownStyle.quoteSpacing)
                .overlay(alignment: .leading) {
                    WavyLine(wave: wave, inset: lineWidth / 2)
                        .stroke(.separator, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
                        .frame(width: wave.width(lineWidth: lineWidth))
                }
        case .code(_, let text):
            ScrollView(.horizontal) {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .padding(MarkdownStyle.codePadding)
            }
            .background(.fill.tertiary, in: .rect(cornerRadius: MarkdownStyle.codeCornerRadius))
            .opacity(fadingTail.first?.opacity ?? 1)
        case .rule:
            Divider()
                .opacity(fadingTail.first?.opacity ?? 1)
        case .table(let header, let rows):
            // Not faded: a table grows a row at a time, and fading it whole would make it blink with each.
            TableView(header: header, rows: rows, textSize: tableSize)
                .font(.system(size: tableSize))
        }
    }
}

/// A list item's marker: the swirl for a bullet, or the number in bold. The swirl sits at the middle of the first
/// line's letters.
private struct ListMarker: View {
    let marker: String
    let textSize: CGFloat

    @ScaledMetric(relativeTo: .body) private var bulletWidth = MarkdownStyle.bulletWidth

    var body: some View {
        if marker == "•" {
            BulletShape()
                .stroke(.tertiary, style: StrokeStyle(lineWidth: bulletWidth * 2 / 13, lineCap: .round))
                .frame(width: bulletWidth, height: bulletWidth / BulletShape.aspectRatio)
                .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + textSize * 0.35 }
                .accessibilityRepresentation { Text("•") }
        } else {
            Text(marker).bold()
        }
    }
}

/// A table in a rounded frame: the header on a light fill, lines between the rows and the columns, each cell with its
/// inline Markdown, wrapping past `MarkdownStyle.tableCellWidth`. When it is wider than the screen it scrolls sideways
/// inside the frame. VoiceOver reads each cell after its column's name.
private struct TableView: View {
    let header: [String]
    let rows: [[String]]
    let textSize: CGFloat

    @ScaledMetric private var cellWidth = MarkdownStyle.tableCellWidth

    var body: some View {
        let frame = RoundedRectangle(cornerRadius: MarkdownStyle.tableCornerRadius, style: .continuous)
        ViewThatFits(in: .horizontal) {
            grid
            ScrollView(.horizontal) { grid }
        }
        .clipShape(frame)
        .overlay { frame.strokeBorder(.separator, lineWidth: 0.5) }
    }

    private var grid: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(header.enumerated()), id: \.offset) { column, cell in
                    cellView(cell, column: column, style: .secondary)
                        .fontWeight(.medium)
                        .background(.fill.quaternary)
                        .accessibilityAddTraits(.isHeader)
                }
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Divider()
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                        cellView(cell, column: column, style: .primary)
                            .accessibilityLabel(
                                "\(Self.plain(header.indices.contains(column) ? header[column] : "")): \(Self.plain(cell))")
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// A cell filling its place in the grid, so the header's fill and the line before each column but the first
    /// run the row's full height.
    private func cellView(_ text: String, column: Int, style: HierarchicalShapeStyle) -> some View {
        WrappingWidth(maxWidth: cellWidth) {
            InlineText(text: text, style: style, fadingTail: [], size: textSize)
        }
        .padding(.horizontal, MarkdownStyle.tableCellPadding.horizontal)
        .padding(.vertical, MarkdownStyle.tableCellPadding.vertical)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(alignment: .leading) {
            Rectangle().fill(.separator).frame(width: 0.5).opacity(column == 0 ? 0 : 1)
        }
    }

    /// A cell's text without its inline Markdown, for VoiceOver.
    private static func plain(_ text: String) -> String {
        String(InlineText.attributed(text).characters)
    }
}

/// A block's text with its inline Markdown, in `style`, the fading tail drawn with its own opacities. Inline code is
/// in a monospaced font a little larger than `size`, the text's size, on a rounded fill.
private struct InlineText: View {
    let text: String
    let style: HierarchicalShapeStyle
    let fadingTail: [FadingText]
    let size: CGFloat

    var body: some View {
        var rest = text
        var pieces: [(String, Double)] = []
        for fading in fadingTail.reversed() {
            let count = min(fading.characters, rest.count)
            pieces.insert((String(rest.suffix(count)), fading.opacity), at: 0)
            rest = String(rest.dropLast(count))
        }
        pieces.insert((rest, 1), at: 0)
        let codeSize = size * MarkdownStyle.inlineCodeScale
        return pieces.reduce(Text("")) { shown, piece in
            Text("\(shown)\(Self.text(piece.0, codeSize: codeSize).foregroundStyle(style.opacity(piece.1)))")
        }
        .textRenderer(
            InlineCodeRenderer(
                verticalPadding: MarkdownStyle.inlineCodePadding.vertical,
                cornerRadius: MarkdownStyle.inlineCodeCornerRadius))
    }

    /// The text with its inline Markdown read, each stretch of inline code marked for `InlineCodeRenderer` and given
    /// room at its sides.
    private static func text(_ markdown: String, codeSize: CGFloat) -> Text {
        let attributed = attributed(markdown)
        // A no-break space keeps the room with the code; its own tracking, which overrides the text's, widens it to the
        // padding.
        let side = Text("\u{202F}").tracking(MarkdownStyle.inlineCodePadding.horizontal - codeSize * 0.2)
        return attributed.runs.reduce(Text("")) { shown, run in
            let piece = Text(AttributedString(attributed[run.range]))
            guard run.inlinePresentationIntent?.contains(.code) == true else { return Text("\(shown)\(piece)") }
            let code = Text("\(side)\(piece.font(.system(size: codeSize, design: .monospaced)))\(side)")
                .customAttribute(InlineCodeMark())
            return Text("\(shown)\(code)")
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
