import Backend
import SwiftUI

/// One agent's runs as one thread, oldest first, opening at the latest, with a field at the bottom to send the agent a
/// message. While it is shown, the agent's events keep it current: each run as it changes, and while one is carried on,
/// whether it is starting or thinking, and its reply as it is written. The agent's tasks are a step away.
struct ThreadScreen: View {
    let agent: any AgentBackend
    let name: String
    @State private var thread: AgentThread

    init(agent: any AgentBackend, name: String) {
        self.agent = agent
        self.name = name
        _thread = State(initialValue: AgentThread(backend: agent))
    }

    var body: some View {
        LoadableContent(state: thread.runs, onRetry: { thread.retry() }) { runs in
            ScrollView {
                VStack(alignment: .leading, spacing: 48) {
                    ForEach(runs.reversed(), id: \.id) { run in
                        RunView(run: run, progress: thread.progress[run.id])
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .scrollDismissesKeyboard(.interactively)
            .overlay {
                if runs.isEmpty {
                    ContentUnavailableView(
                        "会話はまだありません", systemImage: "bubble.left.and.bubble.right",
                        description: Text("メッセージを送るか、タスクが決まった時刻に動くと、ここに会話が残ります。"))
                }
            }
            .refreshable { await thread.load() }
            .safeAreaInset(edge: .bottom) {
                MessageBar(text: $thread.draft, canSend: thread.canSend) { thread.send() }
            }
        }
        .navigationTitle(name)
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                NavigationLink {
                    TasksScreen(agent: agent)
                } label: {
                    Label("タスク", systemImage: "checklist")
                }
            }
        }
        .alert("送れませんでした", isPresented: $thread.isShowingSendProblem, presenting: thread.sendProblem) { _ in
            Button("OK") {}
        } message: { problem in
            Text(problem.message ?? "")
        }
        .task { await thread.follow() }
    }
}

#if DEBUG
    #Preview("実行あり") {
        NavigationStack {
            ThreadScreen(agent: FakeAgentBackend(), name: "エージェント")
        }
    }

    #Preview("実行なし") {
        NavigationStack {
            ThreadScreen(agent: FakeAgentBackend(.init(runs: [])), name: "エージェント")
        }
    }

    #Preview("返事待ち") {
        NavigationStack {
            ThreadScreen(
                agent: FakeAgentBackend(.init(runs: [Samples.sentRun, Samples.mailRun, Samples.weatherRun])),
                name: "エージェント")
        }
    }
#endif
