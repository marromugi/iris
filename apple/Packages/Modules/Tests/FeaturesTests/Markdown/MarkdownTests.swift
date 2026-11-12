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

    @Test func readsATableWithItsHeaderRowsAndCells() {
        let text = """
            銘柄の動きです。
            | 銘柄 | 値動き | メモ |
            |:--|:--:|--:|
            | A社 | **+2%** | 決算 \\| 好調 |
            | B社 | -1% |
            | C社 | 0% | 横ばい | 余分 |
            続きの段落。
            """

        #expect(
            MarkdownBlock.blocks(of: text) == [
                .paragraph("銘柄の動きです。"),
                .table(
                    header: ["銘柄", "値動き", "メモ"],
                    rows: [["A社", "**+2%**", "決算 | 好調"], ["B社", "-1%", ""], ["C社", "0%", "横ばい"]]),
                .paragraph("続きの段落。"),
            ])
    }

    @Test func linesStartingWithABarWithoutADividerStayAParagraph() {
        #expect(MarkdownBlock.blocks(of: "| a | b |\n| c | d |") == [.paragraph("| a | b |\n| c | d |")])
    }

    @Test func aLineStartingWithABarInAParagraphStaysInIt() {
        #expect(MarkdownBlock.blocks(of: "foo\n| bar\nbaz") == [.paragraph("foo\n| bar\nbaz")])
    }

    @Test func aCellEndingInAnEscapedBackslashStillEndsAtTheBar() {
        #expect(
            MarkdownBlock.blocks(of: "| a | C:\\\\ |\n|---|---|")
                == [.table(header: ["a", "C:\\\\"], rows: [])])
    }

    @Test func aTableRightAfterAQuoteComesAfterIt() {
        #expect(
            MarkdownBlock.blocks(of: "> 引用\n| a |\n|---|\n| 1 |")
                == [.quote("引用"), .table(header: ["a"], rows: [["1"]])])
    }

    @Test func aBarInsideCodeIsCode() {
        #expect(
            MarkdownBlock.blocks(of: "```\n| a |\n|---|\n```") == [.code(language: "", text: "| a |\n|---|")])
    }

    @Test func readsCRLFTabsContinuedItemsAndCodeInsideAList() {
        let text = "# T\r\n- a\r\n  続き\r\n\t- 深い\r\n- 手順\r\n  ```\r\n  code\r\n  ```"

        #expect(
            MarkdownBlock.blocks(of: text) == [
                .heading(level: 1, text: "T"),
                .item(marker: "•", depth: 0, text: "a\n続き"),
                .item(marker: "•", depth: 1, text: "深い"),
                .item(marker: "•", depth: 0, text: "手順"),
                .code(language: "", text: "code"),
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
            ("```\nx = a ** b\n\ny = 1 ** 2\n```\nあと", "```\nx = a ** b\n\ny = 1 ** 2\n```\nあと"),
            ("```\nit's a ` tick\n```\nあと", "```\nit's a ` tick\n```\nあと"),
            ("```md\n```swift\n```\nあと", "```md\n```swift\n```\nあと"),
            ("a \\` b と続き", "a \\` b と続き"),
            ("見て ``", "見て "),
            ("すごい*", "すごい"),
            ("行1\r\n```\r\nコード", "行1\n"),
        ] as [(String, String)])
    func holdsBackFormattingThatHasBegunButNotEnded(text: String, shown: String) {
        #expect(SettledMarkdown.prefix(of: text) == shown)
    }

    @Test func eachPartFadesInFromWhenItCameCountedInTheBlocksOwnText() {
        let start = Date(timeIntervalSince1970: 0)
        // "- 牛乳を\n" came first, then "買う": the item's text is "牛乳を買う".
        let settled = "- 牛乳を買う"
        let reveals: [StreamingMarkdownView.Reveal] = [
            .init(length: 0, at: .distantPast),
            .init(length: 5, at: start),
            .init(length: 7, at: start.addingTimeInterval(0.1)),
        ]

        let soon = StreamingMarkdownView.fadingTail(of: reveals, in: settled, at: start.addingTimeInterval(0.2))
        let later = StreamingMarkdownView.fadingTail(of: reveals, in: settled, at: start.addingTimeInterval(1))
        let beforeAnything = StreamingMarkdownView.fadingTail(of: [], in: settled, at: start)

        #expect(soon.map(\.characters) == [3, 2])
        #expect(beforeAnything == [FadingText(characters: 5, opacity: 0)])
        #expect(abs((soon.first?.opacity ?? 0) - 0.2 / StreamingMarkdownView.fadeIn) < 0.0001)
        #expect(abs((soon.last?.opacity ?? 0) - 0.1 / StreamingMarkdownView.fadeIn) < 0.0001)
        #expect(later.isEmpty)
    }

    @Test func takesTheLargerOfTheSpacesThatMeetBetweenTwoBlocks() {
        let paragraph = MarkdownBlock.paragraph("本文")
        let item = MarkdownBlock.item(marker: "•", depth: 0, text: "項目")
        let title = MarkdownBlock.heading(level: 1, text: "見出し")
        let subsection = MarkdownBlock.heading(level: 3, text: "見出し")

        #expect(MarkdownStyle.spacing(above: paragraph, after: paragraph) == 14)
        #expect(MarkdownStyle.spacing(above: item, after: item) == 10)
        // A list gets more space around it than a paragraph does.
        #expect(MarkdownStyle.spacing(above: item, after: paragraph) == 20)
        #expect(MarkdownStyle.spacing(above: paragraph, after: item) == 20)
        // The heading's space above wins over the paragraph's below, instead of adding to it.
        #expect(MarkdownStyle.spacing(above: title, after: paragraph) == 38)
        #expect(MarkdownStyle.spacing(above: title, after: item) == 38)
        #expect(MarkdownStyle.spacing(above: .heading(level: 4, text: "見出し"), after: paragraph) == 28)
        // Under a small heading a paragraph sits closer than the usual space between blocks.
        #expect(MarkdownStyle.spacing(above: paragraph, after: subsection) == 9)
        #expect(MarkdownStyle.spacing(above: subsection, after: title) == 28)
    }
}
