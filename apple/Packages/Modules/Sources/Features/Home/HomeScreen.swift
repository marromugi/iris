import Backend
import SwiftUI

/// The user's agents, each with when it last ran. Each opens to its thread.
struct HomeScreen: View {
    let directory: any AgentDirectory
    let onSignOut: () -> Void
    @State private var agents = Loadable<[AgentSummary]>.loading

    var body: some View {
        LoadableContent(
            state: agents,
            onRetry: {
                agents = .loading
                Task { await load() }
            }
        ) { agents in
            List(agents) { agent in
                NavigationLink(value: agent) {
                    AgentRow(name: agent.name, lastRanAt: agent.lastRanAt)
                }
            }
            .listStyle(.plain)
            .refreshable { await load() }
        }
        .navigationTitle("Iris")
        #if os(iOS)
            .toolbarTitleDisplayMode(.inlineLarge)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                AccountMenu(onSignOut: onSignOut)
            }
        }
        .navigationDestination(for: AgentSummary.self) { agent in
            ThreadScreen(agent: directory.agent(id: agent.id), name: agent.name)
        }
        .task { await load() }
    }

    private func load() async {
        agents = await agents.reading { () async throws(AppError) -> [AgentSummary] in try await directory.agents() }
    }
}

/// One agent: its name, and when it last ran.
private struct AgentRow: View {
    let name: String
    let lastRanAt: Date?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(name)
                .font(.headline)
                .lineLimit(1)
            Spacer()
            HStack(spacing: 4) {
                if let lastRanAt {
                    AgoText(date: lastRanAt)
                    Text("に稼働")
                } else {
                    Text("まだ動いていません")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
    }
}

/// Signing out.
private struct AccountMenu: View {
    let onSignOut: () -> Void

    var body: some View {
        Menu {
            Button("サインアウト", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive, action: onSignOut)
        } label: {
            Label("アカウント", systemImage: "person.crop.circle")
        }
    }
}

#if DEBUG
    #Preview("エージェント 1 つ") {
        NavigationStack {
            HomeScreen(directory: SingleAgentDirectory(backend: FakeAgentBackend())) {}
        }
    }

    #Preview("エージェントがたくさん") {
        NavigationStack {
            HomeScreen(directory: FakeAgentDirectory()) {}
        }
    }

    #Preview("読み込めない") {
        NavigationStack {
            HomeScreen(directory: SingleAgentDirectory(backend: FakeAgentBackend(.init(failure: .offline)))) {}
        }
    }
#endif
