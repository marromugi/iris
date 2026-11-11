import Backend
import SwiftUI

/// The user's threads in one list, the latest activity first, like a messaging app: each agent's one-to-one thread and
/// the groups together. Each opens to its thread, and an agent or a group can be added.
struct HomeScreen: View {
    let directory: any AgentDirectory
    let onSignOut: () -> Void
    @State private var home = Loadable<Home>.loading
    @State private var adding: Adding?

    /// What the home reads: the threads, and the agents, for naming who is in a group and choosing a group's members.
    struct Home {
        let threads: [ChatThread]
        let agents: [Agent]

        var agentNames: [Agent.ID: String] {
            Dictionary(agents.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        }
    }

    /// Which sheet for adding is open.
    enum Adding: String, Identifiable {
        case agent
        case group
        var id: String { rawValue }
    }

    var body: some View {
        LoadableContent(
            state: home,
            onRetry: {
                home = .loading
                Task { await load() }
            }
        ) { home in
            List(home.threads) { thread in
                NavigationLink(value: thread) {
                    ThreadRow(thread: thread)
                }
            }
            .listStyle(.plain)
            .refreshable { await load() }
            .navigationDestination(for: ChatThread.self) { thread in
                ThreadScreen(thread: thread, agentNames: home.agentNames, directory: directory)
            }
        }
        .navigationTitle("Iris")
        #if os(iOS)
            .toolbarTitleDisplayMode(.inlineLarge)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("エージェントを追加", systemImage: "person.badge.plus") { adding = .agent }
                    Button("グループを作成", systemImage: "person.3") { adding = .group }
                        .disabled((home.value?.agents.count ?? 0) < 2)
                } label: {
                    Label("追加", systemImage: "plus")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                AccountMenu(onSignOut: onSignOut)
            }
        }
        .sheet(item: $adding) { adding in
            switch adding {
            case .agent:
                NewAgentSheet(
                    directory: directory,
                    onAdded: { _ in Task { await load() } },
                    onSignedOut: { home = .failed(.signedOut) }
                )
            case .group:
                NewGroupSheet(
                    directory: directory,
                    agents: home.value?.agents ?? [],
                    onAdded: { _ in Task { await load() } },
                    onSignedOut: { home = .failed(.signedOut) }
                )
            }
        }
        .task { await load() }
    }

    private func load() async {
        home = await home.reading { () async throws(AppError) -> Home in
            Home(threads: try await directory.threads(), agents: try await directory.agents())
        }
    }
}

/// One thread: its name, a mark for a group, and when something last happened in it.
private struct ThreadRow: View {
    let thread: ChatThread

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Label {
                Text(thread.name)
                    .font(.headline)
                    .lineLimit(1)
            } icon: {
                Image(systemName: thread.agentId == nil ? "person.3.fill" : "person.fill")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            AgoText(date: thread.lastActivityAt)
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
    #Preview("スレッドがたくさん") {
        NavigationStack {
            HomeScreen(directory: FakeAgentDirectory()) {}
        }
    }

    #Preview("エージェント 1 つ") {
        NavigationStack {
            HomeScreen(
                directory: FakeAgentDirectory(
                    listed: Array(Samples.agents.prefix(1)), threadsListed: Array(Samples.threads.dropFirst().prefix(1))
                )
            ) {}
        }
    }

    #Preview("読み込めない") {
        NavigationStack {
            HomeScreen(directory: FakeAgentDirectory(failure: .offline)) {}
        }
    }
#endif
