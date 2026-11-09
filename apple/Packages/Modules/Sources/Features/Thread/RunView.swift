import Backend
import SwiftUI

/// One run in a thread: that a schedule ran and with what prompt, then the conversation, then how the run stands.
struct RunView: View {
    let run: Run

    var body: some View {
        let conversation = Conversation(run.messages)
        VStack(alignment: .leading, spacing: 24) {
            ScheduleRanCard(prompt: conversation.prompt, startedAt: run.startedAt)
            ForEach(conversation.blocks) { block in
                BlockView(kind: block.kind)
            }
            RunEnd(status: RunStatus(of: run), endedAt: run.endedAt, lastError: run.lastError)
        }
    }
}

/// That a schedule ran, when, and the prompt it ran with.
private struct ScheduleRanCard: View {
    let prompt: String?
    let startedAt: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("スケジュールが実行されました")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                AgoText(date: startedAt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(prompt ?? "（プロンプトなし）")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(.separator)
        }
    }
}

/// One block of a conversation after its prompt.
private struct BlockView: View {
    let kind: Conversation.Block.Kind

    var body: some View {
        switch kind {
        case .user(let text):
            Text(text)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.fill.tertiary, in: .rect(cornerRadius: 16))
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .assistant(let text):
            Text(text)
                .textSelection(.enabled)
        case .tools(let uses):
            ToolUsesView(uses: uses)
        }
    }
}

/// How the run stands: when it ended, or that it is still going, and why its last attempt failed.
private struct RunEnd: View {
    let status: RunStatus
    let endedAt: Date?
    let lastError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Spacer()
                Image(systemName: status.systemImage)
                    .accessibilityLabel(status.label)
                if let endedAt {
                    AgoText(date: endedAt)
                } else {
                    Text(status.label)
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .combine)
            if let lastError {
                Text(lastError)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
        }
        .font(.caption)
    }
}

#if DEBUG
    #Preview("完了") {
        ScrollView {
            RunView(run: Samples.mailRun).padding()
        }
    }

    #Preview("やり直し待ち") {
        ScrollView {
            RunView(run: Samples.retryingRun).padding()
        }
    }

    #Preview("失敗") {
        ScrollView {
            RunView(run: Samples.gaveUpRun).padding()
        }
    }
#endif
