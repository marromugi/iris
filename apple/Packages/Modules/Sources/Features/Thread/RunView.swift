import Backend
import SwiftUI

/// One run in a thread: the schedule that started it with its prompt (a run that replies to a post leaves the post to
/// be shown on its own), whose run it is when the thread has several agents, then the conversation, then, until the
/// model writes, the thinking line where the reply will go; once it writes, the message so far and how the run stands.
struct RunView: View {
    let run: Run
    /// How the run is getting on, while it is carried on.
    var progress: RunProgress?
    /// The agent whose run it is, shown with its orb and name in a thread of several agents.
    var speaker: Agent?

    var body: some View {
        let conversation = Conversation(run.messages)
        VStack(alignment: .leading, spacing: 24) {
            if run.postId == nil {
                ScheduleRanCard(prompt: conversation.prompt, startedAt: run.startedAt)
            }
            if let speaker {
                HStack(spacing: 8) {
                    AgentOrb(look: speaker.look, size: 22)
                    Text(speaker.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(conversation.blocks) { block in
                BlockView(kind: block.kind)
            }
            let status = RunStatus(of: run, progress: progress)
            switch status {
            case .running, .starting, .thinking:
                ThinkingLine(status: status)
                    .id(status)
            default:
                if case .case3(let writing)? = progress {
                    StreamingMarkdownView(text: writing.text)
                }
                // A failure from an earlier attempt is no longer the news while another attempt is under way.
                RunEnd(status: status, endedAt: run.endedAt, lastError: progress == nil ? run.lastError : nil)
            }
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
            UserBubble(text: text)
        case .assistant(let text):
            MarkdownView(blocks: MarkdownBlock.blocks(of: text))
        case .tools(let uses):
            ToolUsesView(uses: uses)
        }
    }
}

/// What the user said, on the right.
struct UserBubble: View {
    let text: String

    var body: some View {
        Text(text)
            .textSelection(.enabled)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.fill.tertiary, in: .rect(cornerRadius: 16))
            .frame(maxWidth: .infinity, alignment: .trailing)
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

    #Preview("返事待ち") {
        ScrollView {
            RunView(run: Samples.sentRun).padding()
        }
    }

    #Preview("考え中") {
        ScrollView {
            RunView(run: Samples.sentRun, progress: Samples.thinking).padding()
        }
    }

    #Preview("書いている途中") {
        ScrollView {
            RunView(run: Samples.sentRun, progress: Samples.writing("下書きを作りました。件名は「請求書の")).padding()
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
