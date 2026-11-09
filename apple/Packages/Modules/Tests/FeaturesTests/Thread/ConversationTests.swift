import Backend
import Foundation
import Testing

@testable import Features

struct ConversationTests {
    @Test func gathersToolsCalledWithNoTextBetweenThemEachWithWhatItGaveBack() {
        let conversation = Conversation(Samples.mailRun.messages)

        #expect(conversation.prompt == "昨日届いたメールを確認して、返信が必要そうなものをトリアージして教えて")
        #expect(
            conversation.blocks.map(\.kind) == [
                .assistant("今から確認します。"),
                .tools([.init(id: 0, name: "maillist", result: .init(content: "42 件のメールがあります。", isError: false))]),
                .assistant("返信が要りそうなものを開いて確かめます。"),
                .tools([
                    .init(
                        id: 1, name: "mailread",
                        result: .init(content: "件名: 来週の打ち合わせ\n日程の候補を 3 つ挙げてほしい、とのこと。", isError: false)),
                    .init(
                        id: 2, name: "mailread",
                        result: .init(content: "件名: 請求書の確認\n金曜までに返事がほしい、とのこと。", isError: false)),
                ]),
                .assistant("返信が要りそうなのは 2 件です。打ち合わせの日程と、金曜が期限の請求書の確認です。"),
            ])
    }

    @Test func aToolsErrorIsMarked() {
        let conversation = Conversation(Samples.gaveUpRun.messages)

        #expect(
            conversation.blocks.map(\.kind) == [
                .tools([
                    .init(id: 0, name: "calendar", result: .init(content: "The calendar could not be reached.", isError: true))
                ])
            ])
    }
}
