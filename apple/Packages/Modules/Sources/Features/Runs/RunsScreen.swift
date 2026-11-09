import Backend
import SwiftUI

/// The user's latest runs, newest first. Each opens to its conversation.
struct RunsScreen: View {
    let agent: any AgentBackend
    @State private var runs = Loadable<[Run]>.loading

    var body: some View {
        LoadableContent(
            state: runs,
            onRetry: {
                runs = .loading
                Task { await load() }
            }
        ) { runs in
            List(runs, id: \.id) { run in
                NavigationLink(value: run) {
                    RunRow(run: run)
                }
            }
            .overlay {
                if runs.isEmpty {
                    ContentUnavailableView(
                        "実行はまだありません", systemImage: "clock",
                        description: Text("タスクが決まった時刻に動くと、ここに会話が残ります。"))
                }
            }
            .refreshable { await load() }
        }
        .navigationTitle("履歴")
        .navigationDestination(for: Run.self) { RunScreen(run: $0) }
        .task { await load() }
    }

    private func load() async {
        runs = await runs.reading { () async throws(AppError) -> [Run] in try await agent.recentRuns(limit: 20) }
    }
}

/// One run: the prompt it started with, when it started, and how it stands.
private struct RunRow: View {
    let run: Run

    var body: some View {
        let status = RunStatus(of: run)
        VStack(alignment: .leading, spacing: 4) {
            Text(Conversation(run.messages).prompt ?? "（プロンプトなし）")
                .lineLimit(2)
            HStack {
                Text(DateText.moment(run.startedAt))
                Spacer()
                Label(status.label, systemImage: status.systemImage)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

#if DEBUG
    #Preview("実行あり") {
        NavigationStack {
            RunsScreen(agent: FakeAgentBackend())
        }
    }

    #Preview("実行なし") {
        NavigationStack {
            RunsScreen(agent: FakeAgentBackend(.init(runs: [])))
        }
    }
#endif
