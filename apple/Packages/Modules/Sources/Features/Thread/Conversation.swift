import Backend

/// A run's conversation as the thread shows it: the prompt the run started with, then what followed, with the tools
/// the assistant called one after another gathered into one block.
struct Conversation: Equatable {
    struct Block: Identifiable, Equatable {
        enum Kind: Equatable {
            /// What the user said after the prompt.
            case user(String)
            /// Text the assistant wrote.
            case assistant(String)
            /// Tools the assistant called with no text between them, in order.
            case tools([ToolUse])
        }

        /// The block's place in the conversation, which only grows at the end.
        let id: Int
        let kind: Kind
    }

    /// A tool the assistant called, and what it gave back once it answered.
    struct ToolUse: Identifiable, Equatable {
        /// The call's place among the run's calls.
        let id: Int
        let name: String
        let result: ToolResult?
        /// The consult the call asked in, when it asked another agent.
        var consult: ChatThread?
    }

    struct ToolResult: Equatable {
        let content: String
        let isError: Bool
    }

    /// What the user said first, which a run starts with.
    let prompt: String?
    let blocks: [Block]

    /// A run's conversation, its tool calls that asked another agent with their consults.
    init(_ run: Run) {
        self.init(run.messages, consults: run.consults)
    }

    init(_ messages: [RunMessage], consults: [Consult] = []) {
        let consultByCall = Dictionary(consults.map { ($0.callId, $0.thread) }, uniquingKeysWith: { first, _ in first })
        // The generator numbers the cases in the order of the oneOf in openapi.json: user, assistant, tool; and for an
        // assistant's parts, text, tool call.
        //
        // The agent takes a result only for the oldest call still waiting for one, so the nth result answers the nth
        // call.
        var results: [ToolResult] = []
        for case .case3(let result) in messages {
            results.append(ToolResult(content: result.content, isError: result.isError))
        }

        var prompt: String?
        var kinds: [Block.Kind] = []
        var tools: [ToolUse] = []
        var calls = 0
        func endTools() {
            guard !tools.isEmpty else { return }
            kinds.append(.tools(tools))
            tools = []
        }
        for message in messages {
            switch message {
            case .case1(let user):
                if prompt == nil {
                    prompt = user.text
                } else {
                    endTools()
                    kinds.append(.user(user.text))
                }
            case .case2(let assistant):
                for part in assistant.parts {
                    switch part {
                    case .case1(let text):
                        endTools()
                        kinds.append(.assistant(text.text))
                    case .case2(let call):
                        tools.append(
                            ToolUse(
                                id: calls, name: call.name, result: calls < results.count ? results[calls] : nil,
                                consult: consultByCall[call.id]))
                        calls += 1
                    }
                }
            case .case3:
                break
            }
        }
        endTools()
        self.prompt = prompt
        blocks = kinds.enumerated().map { Block(id: $0.offset, kind: $0.element) }
    }
}
