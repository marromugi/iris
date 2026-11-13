import Backend
import SwiftUI

/// One thread, oldest first, opening at the latest: the user's posts, and the runs that reply to them or that a schedule
/// started; in a group, each run with its agent's name and orb. A field at the bottom sends a post. While
/// it is shown, the thread's events keep it current: each post and run as it changes, and while a run is carried on,
/// whether it is starting or thinking, and its reply as it is written. An agent's one-to-one thread has its tasks a step
/// away, and is where the agent is deactivated and activated again; while it is deactivated, the field gives way to
/// the way to activate it.
struct ThreadScreen: View {
    let thread: ChatThread
    /// The user's agents by ID, for showing whose run each is.
    let agents: [Agent.ID: Agent]
    let directory: any AgentDirectory
    @State private var open: OpenThread
    /// The one-to-one thread's agent being active; nil for a group or a consult.
    @State private var activity: AgentActivity?
    @State private var isConfirmingDeactivation = false
    @Environment(\.colorScheme) private var colorScheme

    /// The screen's background: white, or in dark mode a black a little lifted, which is easier on the eyes than pure
    /// black behind the text. Views that cut out the background, such as a tool's dot, take it too.
    private static func background(in scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 22 / 255, green: 22 / 255, blue: 24 / 255) : .white
    }

    /// `onAgentSwitched` is called with the agent and whether it is now active, once the one-to-one thread's agent was
    /// deactivated or activated.
    init(
        thread: ChatThread, agents: [Agent.ID: Agent], directory: any AgentDirectory,
        onAgentSwitched: @escaping (Agent.ID, Bool) -> Void = { _, _ in }
    ) {
        self.thread = thread
        self.agents = agents
        self.directory = directory
        _open = State(initialValue: OpenThread(backend: directory.thread(id: thread.id)))
        _activity = State(
            initialValue: thread.agentId.map { agentID in
                AgentActivity(
                    backend: directory.agent(id: agentID), isActive: agents[agentID]?.active ?? true,
                    onSwitched: { active in onAgentSwitched(agentID, active) })
            })
    }

    var body: some View {
        LoadableContent(state: open.entries, onRetry: { open.retry() }) { entries in
            ScrollView {
                VStack(alignment: .leading, spacing: 48) {
                    ForEach(entries.reversed()) { entry in
                        switch entry {
                        case .post(let post):
                            if let asker = post.agentId {
                                AgentPostView(post: post, agent: agents[asker])
                            } else {
                                UserBubble(text: post.text)
                            }
                        case .run(let run):
                            // A group's or a consult's runs show whose they are.
                            if thread.agentId == nil {
                                GroupRunView(run: run, progress: open.progress[run.id], agent: agents[run.agentId])
                            } else {
                                RunView(run: run, progress: open.progress[run.id])
                            }
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
                // A consult is only for reading: the agents ask and answer in it.
                if let activity, !activity.isActive {
                    DeactivatedBar(isSwitching: activity.isSwitching) { activity.activate() }
                } else if thread.consultRunId == nil {
                    MessageBar(
                        text: $open.draft, canSend: open.canSend, images: open.images, imagesLeft: open.imagesLeft,
                        onPick: { open.attach($0) }, onRemove: { open.remove($0) }
                    ) { open.send() }
                }
            }
        }
        .background(Self.background(in: colorScheme), ignoresSafeAreaEdges: .all)
        .backgroundStyle(Self.background(in: colorScheme))
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
            if let activity {
                ToolbarItem(placement: .secondaryAction) {
                    if activity.isActive {
                        Button("停止", systemImage: "pause.circle") { isConfirmingDeactivation = true }
                            .disabled(activity.isSwitching)
                    } else {
                        Button("再開", systemImage: "play.circle") { activity.activate() }
                            .disabled(activity.isSwitching)
                    }
                }
            }
        }
        .confirmationDialog(
            "\(thread.name)を停止しますか？", isPresented: $isConfirmingDeactivation, titleVisibility: .visible
        ) {
            Button("停止", role: .destructive) { activity?.deactivate() }
        } message: {
            Text("停止しているあいだは返事をせず、タスクも動きません。会話やタスクは消えず、いつでも再開できます。")
        }
        .alert(
            "切り替えられませんでした",
            isPresented: Binding(
                get: { activity?.isShowingProblem ?? false }, set: { activity?.isShowingProblem = $0 }),
            presenting: activity?.problem
        ) { _ in
            Button("OK") {}
        } message: { problem in
            Text(problem.message ?? "")
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
            ? "メッセージを送ると、@ で名前を挙げたエージェントが、挙げなければ全員が返事をします。停止中のエージェントは返事をしません。"
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

    #Preview("停止中") {
        let thread = Samples.threads[1]
        let stopped = agents.mapValues { agent in
            var agent = agent
            agent.active = agent.id != thread.agentId
            return agent
        }
        NavigationStack {
            ThreadScreen(thread: thread, agents: stopped, directory: FakeAgentDirectory())
        }
    }

    #Preview("相談（読むだけ）") {
        NavigationStack {
            ThreadScreen(
                thread: Samples.consult, agents: agents,
                directory: FakeAgentDirectory(
                    thread: FakeThreadBackend(.init(runs: [Samples.consultAnswer], posts: [Samples.consultQuestion]))))
        }
    }
#endif
