import Backend
import SwiftUI

/// One run: how it went, then its conversation — what the user asked, what the assistant wrote, and the tools it
/// called with what they gave back.
struct RunScreen: View {
    let run: Run

    var body: some View {
        let status = RunStatus(of: run)
        List {
            Section {
                LabeledContent("状態") {
                    Label(status.label, systemImage: status.systemImage)
                }
                LabeledContent("開始", value: DateText.moment(run.startedAt))
                if let endedAt = run.endedAt {
                    LabeledContent("終了", value: DateText.moment(endedAt))
                }
                if run.failedAttempts > 0 {
                    LabeledContent("失敗した回数", value: "\(run.failedAttempts) 回")
                }
                if let lastError = run.lastError {
                    CodeText(text: lastError)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }
            Section("会話") {
                ForEach(Conversation(run.messages).entries) { entry in
                    ConversationEntryView(kind: entry.kind)
                }
            }
        }
        .navigationTitle("実行")
    }
}

/// One entry of a conversation: who it is from, and what it says.
private struct ConversationEntryView: View {
    let kind: Conversation.Entry.Kind

    var body: some View {
        switch kind {
        case .user(let text):
            EntryView(title: "あなた", systemImage: "person") { Text(text) }
        case .assistant(let text):
            EntryView(title: "エージェント", systemImage: "sparkles") { Text(text) }
        case .toolCall(let name, let input):
            EntryView(title: "ツールを呼んだ：\(name)", systemImage: "wrench.and.screwdriver") {
                if let input { CodeText(text: input) }
            }
        case .toolResult(let toolName, let content, let isError):
            EntryView(
                title: (isError ? "ツールのエラー" : "ツールの結果") + (toolName.map { "：\($0)" } ?? ""),
                systemImage: isError ? "exclamationmark.triangle" : "arrow.turn.down.left",
                isError: isError
            ) {
                CodeText(text: content)
            }
        }
    }
}

private struct EntryView<Content: View>: View {
    let title: String
    let systemImage: String
    var isError = false
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.caption)
                .foregroundStyle(isError ? .red : .secondary)
            content
                .textSelection(.enabled)
        }
        .padding(.vertical, 2)
    }
}

/// JSON or a tool's output, as it came.
private struct CodeText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.callout.monospaced())
    }
}

#if DEBUG
    #Preview("完了") {
        NavigationStack {
            RunScreen(run: Samples.weatherRun)
        }
    }

    #Preview("失敗") {
        NavigationStack {
            RunScreen(run: Samples.gaveUpRun)
        }
    }
#endif
