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

    @Test func onlyTheToolCallThatAskedCarriesItsConsult() {
        var run = Samples.mailRun
        let consult = ChatThread(
            id: "consult-1", name: "株価の確認", agentId: nil, consultRunId: run.id, agentIds: ["mail", "stocks"],
            lastActivityAt: Samples.moment("2026-11-10T00:01:00Z"))
        run.consults = [Consult(callId: "call-2", thread: consult), Consult(callId: "call-9", thread: consult)]

        let uses = Conversation(run).blocks.flatMap { block -> [Conversation.ToolUse] in
            if case .tools(let uses) = block.kind { uses } else { [] }
        }

        #expect(uses.map(\.consult) == [nil, consult, nil])
    }

    @Test func aQuestionAskedOfTheUserIsShownWithItsAnswerApartFromTheTools() {
        #expect(
            Conversation(Samples.answeredRun).blocks.map(\.kind) == [
                .assistant("候補を 3 つ見つけました。"),
                .question("どの店にしますか？", answer: .given("イタリアン")),
                .assistant("土曜 12:00 にイタリアンを 2 名で予約しました。"),
            ])
        #expect(
            Conversation(Samples.askingRun).blocks.map(\.kind) == [
                .question("美容院はどちらの日に予約しますか？", answer: .waiting)
            ])
        var ended = Samples.askingRun
        ended.endedAt = Samples.moment("2026-11-10T00:20:00Z")
        #expect(Conversation(ended).blocks.map(\.kind) == [.question("美容院はどちらの日に予約しますか？", answer: .none)])
    }

    @Test func onlyAskUserIsShownAsAQuestion() throws {
        var run = Samples.askingRun
        let asked = try #require(run.messages.last)
        guard case .case2(var assistant) = asked, case .case2(var call) = assistant.parts.first else {
            Issue.record("The sample asking run doesn't end with a tool call.")
            return
        }
        call.name = "survey"
        assistant.parts = [.case2(call)]
        run.messages[run.messages.count - 1] = .case2(assistant)

        #expect(Conversation(run).blocks.map(\.kind) == [.tools([.init(id: 0, name: "survey", result: nil)])])
    }

    @Test func aQuestionThatWasRefusedStaysATool() {
        var run = Samples.askingRun
        run.messages.append(.case3(.init(role: .tool, callId: "call-1", isError: true, content: "ask_user wasn't asked")))

        #expect(
            Conversation(run).blocks.map(\.kind) == [
                .tools([.init(id: 0, name: "ask_user", result: .init(content: "ask_user wasn't asked", isError: true))])
            ])
    }
}
