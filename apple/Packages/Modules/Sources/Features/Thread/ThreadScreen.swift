import Backend
import SwiftUI

/// One thread, oldest first, opening at the latest: the user's posts, and the runs that reply to them or that a schedule
/// started, each run with its agent's name when the thread has several agents. A field at the bottom sends a post. While
/// it is shown, the thread's events keep it current: each post and run as it changes, and while a run is carried on,
/// whether it is starting or thinking, and its reply as it is written. An agent's one-to-one thread has its tasks a step
/// away.
struct ThreadScreen: View {
    let thread: ChatThread
    /// The user's agents by ID, for showing whose run each is.
    let agents: [Agent.ID: Agent]
    let directory: any AgentDirectory
    @State private var open: OpenThread

    init(thread: ChatThread, agents: [Agent.ID: Agent], directory: any AgentDirectory) {
        self.thread = thread
        self.agents = agents
        self.directory = directory
        _open = State(initialValue: OpenThread(backend: directory.thread(id: thread.id)))
    }

    var body: some View {
        LoadableContent(state: open.entries, onRetry: { open.retry() }) { entries in
            ScrollView {
                VStack(alignment: .leading, spacing: 48) {
                    ForEach(entries.reversed()) { entry in
                        switch entry {
                        case .post(let post):
                            UserBubble(text: post.text)
                        case .run(let run):
                            RunView(run: run, progress: open.progress[run.id], agent: agents[run.agentId])
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .scrollDismissesKeyboard(.interactively)
            .overlay {
                if entries.isEmpty {
                    ContentUnavailableView(
                        "会話はまだありません", systemImage: "bubble.left.and.bubble.right",
                        description: Text(emptyDescription))
                }
            }
            .refreshable { await open.load() }
            .safeAreaInset(edge: .bottom) {
                MessageBar(text: $open.draft, canSend: open.canSend) { open.send() }
            }
        }
        .navigationTitle(thread.name)
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            if let agentID = thread.agentId {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink {
                        TasksScreen(agent: directory.agent(id: agentID))
                    } label: {
                        Label("タスク", systemImage: "checklist")
                    }
                }
            }
        }
        .alert("送れませんでした", isPresented: $open.isShowingSendProblem, presenting: open.sendProblem) { _ in
            Button("OK") {}
        } message: { problem in
            Text(problem.message ?? "")
        }
        .task { await open.follow() }
    }

    private var emptyDescription: String {
        thread.agentId == nil
            ? "メッセージを送ると、@ で名前を挙げたエージェントが、挙げなければ全員が返事をします。"
            : "メッセージを送るか、タスクが決まった時刻に動くと、ここに会話が残ります。"
    }
}

#if DEBUG
    private let agents = Dictionary(uniqueKeysWithValues: Samples.agents.map { ($0.id, $0) })

    #Preview("実行あり") {
        NavigationStack {
            ThreadScreen(thread: Samples.threads[1], agents: agents, directory: FakeAgentDirectory())
        }
    }

    #Preview("グループ") {
        NavigationStack {
            ThreadScreen(thread: Samples.threads[0], agents: agents, directory: FakeAgentDirectory())
        }
    }

    #Preview("実行なし") {
        NavigationStack {
            ThreadScreen(
                thread: Samples.threads[1], agents: agents,
                directory: FakeAgentDirectory(thread: FakeThreadBackend(.init(runs: [], posts: []))))
        }
    }
#endif
