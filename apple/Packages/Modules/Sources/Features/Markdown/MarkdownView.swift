import Foundation
import SwiftUI

/// Markdown drawn as blocks: headings, paragraphs, list items, quotes, code, and rules, with emphasis, inline code and
/// links inside them. `fadingTail` gives the opacity of the last characters of the last block, newest last, so text
/// that just came in fades in.
struct MarkdownView: View {
    let blocks: [MarkdownBlock]
    var fadingTail: [FadingText] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                MarkdownBlockView(block: block, fadingTail: index == blocks.count - 1 ? fadingTail : [])
                    .transition(.opacity)
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
            InlineText(text: text, fadingTail: fadingTail)
                .font(level == 1 ? .title3.bold() : level == 2 ? .headline : .subheadline.bold())
        case .paragraph(let text):
            InlineText(text: text, fadingTail: fadingTail)
        case .item(let marker, let depth, let text):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(marker).foregroundStyle(.secondary)
                InlineText(text: text, fadingTail: fadingTail)
            }
            .padding(.leading, CGFloat(depth) * 16)
        case .quote(let text):
            InlineText(text: text, fadingTail: fadingTail)
                .foregroundStyle(.secondary)
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
        case .rule:
            Divider()
        }
    }
}

/// A block's text with its inline Markdown, the fading tail drawn with its own opacities.
private struct InlineText: View {
    let text: String
    let fadingTail: [FadingText]

    var body: some View {
        var rest = text
        var pieces: [(String, Double)] = []
        for fading in fadingTail.reversed() {
            let count = min(fading.characters, rest.count)
            pieces.insert((String(rest.suffix(count)), fading.opacity), at: 0)
            rest = String(rest.dropLast(count))
        }
        return pieces.reduce(Text(Self.attributed(rest))) { shown, piece in
            Text("\(shown)\(Text(Self.attributed(piece.0)).foregroundStyle(.primary.opacity(piece.1)))")
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
                        """)
            )
            .padding()
        }
    }
#endif
