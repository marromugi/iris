import Foundation
import Testing

@testable import Features

struct MarkdownTests {
    @Test func splitsTextIntoTheBlocksTheAppDraws() {
        let text = """
            # 今日の予定
            朝は**会議**です。
            続きの行。

            - 牛乳を買う
              - 低脂肪
            1. 返信する
            > 引用です
            ---
            ```swift
            let a = 1
            ```
            """

        #expect(
            MarkdownBlock.blocks(of: text) == [
                .heading(level: 1, text: "今日の予定"),
                .paragraph("朝は**会議**です。\n続きの行。"),
                .item(marker: "•", depth: 0, text: "牛乳を買う"),
                .item(marker: "•", depth: 1, text: "低脂肪"),
                .item(marker: "1.", depth: 0, text: "返信する"),
                .quote("引用です"),
                .rule,
                .code(language: "swift", text: "let a = 1"),
            ])
    }

    @Test(
        arguments: [
            ("詳しくは[ドキュメ", "詳しくは"),
            ("詳しくは[ドキュメント](https://exa", "詳しくは"),
            ("詳しくは[ドキュメント](https://example.com)を見て", "詳しくは[ドキュメント](https://example.com)を見て"),
            ("配列[0] を見る", "配列[0] を見る"),
            ("これは**大事", "これは"),
            ("これは**大事**です", "これは**大事**です"),
            ("`let a", ""),
            ("`let a` です", "`let a` です"),
            ("**太字** と `コ", "**太字** と "),
            ("~~取り消", ""),
            ("説明\n```swift\nlet a", "説明\n"),
            ("説明\n```swift\nlet a\n```\n続き", "説明\n```swift\nlet a\n```\n続き"),
            ("前の段落の[リンク](https://a.b)\n\n次の段落の[途中", "前の段落の[リンク](https://a.b)\n\n次の段落の"),
        ] as [(String, String)])
    func holdsBackFormattingThatHasBegunButNotEnded(text: String, shown: String) {
        #expect(SettledMarkdown.prefix(of: text) == shown)
    }

    @Test func eachPartFadesInFromWhenItCameAndThenStays() {
        let start = Date(timeIntervalSince1970: 0)
        let reveals: [StreamingMarkdownView.Reveal] = [
            .init(length: 0, at: .distantPast),
            .init(length: 10, at: start),
            .init(length: 15, at: start.addingTimeInterval(0.1)),
        ]

        let soon = StreamingMarkdownView.fadingTail(of: reveals, at: start.addingTimeInterval(0.2))
        let later = StreamingMarkdownView.fadingTail(of: reveals, at: start.addingTimeInterval(1))

        #expect(soon.map(\.characters) == [10, 5])
        #expect(abs((soon.first?.opacity ?? 0) - 0.2 / StreamingMarkdownView.fadeIn) < 0.0001)
        #expect(abs((soon.last?.opacity ?? 0) - 0.1 / StreamingMarkdownView.fadeIn) < 0.0001)
        #expect(later.isEmpty)
    }
}
