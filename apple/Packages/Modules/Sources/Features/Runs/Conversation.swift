import Backend
import Foundation

/// A run's conversation as the run screen shows it, one entry per text, tool call, and tool result, in order.
struct Conversation: Equatable {
    struct Entry: Identifiable, Equatable {
        enum Kind: Equatable {
            /// What the user said; a run starts with the task's prompt.
            case user(String)
            /// Text the assistant wrote.
            case assistant(String)
            /// A tool the assistant called, with its input as JSON when it gave one.
            case toolCall(name: String, input: String?)
            /// What a tool gave back, with the tool's name when its call is in the conversation.
            case toolResult(toolName: String?, content: String, isError: Bool)
        }

        /// The entry's place in the conversation, which only grows at the end.
        let id: Int
        let kind: Kind
    }

    let entries: [Entry]

    init(_ messages: [RunMessage]) {
        var kinds: [Entry.Kind] = []
        var toolNames: [String: String] = [:]
        // The generator numbers the cases in the order of the oneOf in openapi.json: user, assistant, tool; and for an
        // assistant's parts, text, tool call.
        for message in messages {
            switch message {
            case .case1(let user):
                kinds.append(.user(user.text))
            case .case2(let assistant):
                for part in assistant.parts {
                    switch part {
                    case .case1(let text):
                        kinds.append(.assistant(text.text))
                    case .case2(let call):
                        toolNames[call.id] = call.name
                        kinds.append(.toolCall(name: call.name, input: call.input.map(Self.json)))
                    }
                }
            case .case3(let result):
                kinds.append(.toolResult(toolName: toolNames[result.callId], content: result.content, isError: result.isError))
            }
        }
        entries = kinds.enumerated().map { Entry(id: $0.offset, kind: $0.element) }
    }

    /// The prompt the run started with: what the user said first.
    var prompt: String? {
        entries.lazy.compactMap { if case .user(let text) = $0.kind { text } else { nil } }.first
    }

    private static func json(_ value: some Encodable) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else {
            preconditionFailure("A value decoded from JSON encodes as JSON again")
        }
        return text
    }
}
