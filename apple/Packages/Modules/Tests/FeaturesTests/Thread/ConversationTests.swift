import Backend
import Foundation
import Testing

@testable import Features

struct ConversationTests {
    @Test func showsEachTextToolCallAndResultInOrderWithTheToolsName() {
        let conversation = Conversation(Samples.weatherRun.messages)

        #expect(
            conversation.entries.map(\.kind) == [
                .user("今日の東京の天気を調べて、傘が要るかを一言で教えて。"),
                .assistant("天気予報を調べます。"),
                .toolCall(name: "weather", input: "{\n  \"city\" : \"Tokyo\",\n  \"day\" : \"today\"\n}"),
                .toolResult(toolName: "weather", content: "{\"rain\": 0.7, \"high\": 16}", isError: false),
                .assistant("午後から雨の見込みです。傘を持っていきましょう。"),
            ])
        #expect(conversation.prompt == "今日の東京の天気を調べて、傘が要るかを一言で教えて。")
    }

    @Test func aToolsErrorIsMarked() {
        let conversation = Conversation(Samples.gaveUpRun.messages)

        #expect(
            conversation.entries.last?.kind
                == .toolResult(toolName: "calendar", content: "The calendar could not be reached.", isError: true))
    }
}
