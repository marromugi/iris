import Backend
import SwiftUI

/// One run in a thread: the schedule that started it with its prompt (a run that replies to a post leaves the post to
/// be shown on its own), then the agent's message, set in from the left. It starts with the agent's name, then the
/// conversation, then, until the model writes, the thinking line where the reply will go, or the message so far.
/// Beside the message's last line, in the space on the left, the blob moves while the run goes on, and the agent's orb
/// takes its place once the run ends, so whose message it is shows at its foot however it grows.
struct RunView: View {
    let run: Run
    /// How the run is getting on, while it is carried on.
    var progress: RunProgress?
    /// The agent whose run it is; nil when the thread doesn't know it.
    var agent: Agent?

    /// How wide the space on the left of a message is, where the blob and the orb go.
    static let gutter: CGFloat = 28

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let conversation = Conversation(run.messages)
        let status = RunStatus(of: run, progress: progress)
        VStack(alignment: .leading, spacing: 24) {
            if run.postId == nil {
                ScheduleRanCard(prompt: conversation.prompt, startedAt: run.startedAt)
            }
            HStack(alignment: .bottom, spacing: 12) {
                RunMark(status: status, look: agent?.look)
                    .frame(width: Self.gutter)
                    // Heard after the message, as it is seen at its foot.
                    .accessibilitySortPriority(-1)
                VStack(alignment: .leading, spacing: 24) {
                    if let agent {
                        Text(agent.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(OrbPalette.of(agent.look).ink(in: colorScheme))
                    }
                    ForEach(conversation.blocks) { block in
                        BlockView(kind: block.kind)
                    }
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
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// What sits beside a message's last line: the moving blob while the run goes on, and once it ended, the agent's orb,
/// or the status's mark when the agent isn't known. VoiceOver hears how the run stands.
private struct RunMark: View {
    let status: RunStatus
    let look: AgentLook?

    var body: some View {
        Group {
            switch status {
            case .finished, .gaveUp:
                if let look {
                    AgentOrb(look: look, size: RunView.gutter)
                } else {
                    Image(systemName: status.systemImage)
                        .foregroundStyle(.secondary)
                }
            default:
                // One blob through every status of a run that goes on, so it keeps flowing when the status changes.
                ThinkingBlob(energy: status == .thinking ? 1 : 0.4)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(status.label)
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

/// How the run stands, when there is something to say: that it waits to be tried again, or that it failed and when,
/// and why its last attempt failed. A run that finished says nothing; its orb shows it is done.
private struct RunEnd: View {
    let status: RunStatus
    let endedAt: Date?
    let lastError: String?

    var body: some View {
        if status == .retrying || status == .gaveUp || lastError != nil {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
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
}

#if DEBUG
    #Preview("完了") {
        ScrollView {
            RunView(run: Samples.mailRun, agent: Samples.agents[0]).padding()
        }
    }

    #Preview("返事待ち") {
        ScrollView {
            RunView(run: Samples.sentRun, agent: Samples.agents[0]).padding()
        }
    }

    #Preview("考え中") {
        ScrollView {
            RunView(run: Samples.sentRun, progress: Samples.thinking, agent: Samples.agents[0]).padding()
        }
    }

    #Preview("書いている途中") {
        ScrollView {
            RunView(run: Samples.sentRun, progress: Samples.writing("下書きを作りました。件名は「請求書の"), agent: Samples.agents[0])
                .padding()
        }
    }

    #Preview("やり直し待ち") {
        ScrollView {
            RunView(run: Samples.retryingRun, agent: Samples.agents[1]).padding()
        }
    }

    #Preview("失敗") {
        ScrollView {
            RunView(run: Samples.gaveUpRun, agent: Samples.agents[1]).padding()
        }
    }
#endif
