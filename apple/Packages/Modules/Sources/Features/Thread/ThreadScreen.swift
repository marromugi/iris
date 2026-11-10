import Backend
import SwiftUI

/// One agent's runs as one thread, oldest first, opening at the latest. The agent's tasks are a step away.
struct ThreadScreen: View {
    let agent: any AgentBackend
    let name: String
    @State private var runs = Loadable<[Run]>.loading

    var body: some View {
        LoadableContent(
            state: runs,
            onRetry: {
                runs = .loading
                Task { await load() }
            }
        ) { runs in
            ScrollView {
                VStack(alignment: .leading, spacing: 48) {
                    ForEach(runs.reversed(), id: \.id) { run in
                        RunView(run: run)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .overlay {
                if runs.isEmpty {
                    ContentUnavailableView(
                        "実行はまだありません", systemImage: "clock",
                        description: Text("タスクが決まった時刻に動くと、ここに会話が残ります。"))
                }
            }
            .refreshable { await load() }
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
        .task { await load() }
    }

    /// How many of the latest runs the thread shows.
    private static let runsShown = 50

    private func load() async {
        runs = await runs.reading { () async throws(AppError) -> [Run] in
            try await agent.recentRuns(limit: Self.runsShown)
        }
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
#endif
