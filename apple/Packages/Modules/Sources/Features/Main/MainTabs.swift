import SwiftUI

/// What a signed-in user sees, by tab: their tasks, and the runs of those tasks. Each tab keeps its own stack of
/// screens.
struct MainTabs: View {
    let agent: any AgentBackend
    let onSignOut: () -> Void

    var body: some View {
        TabView {
            Tab("タスク", systemImage: "checklist") {
                NavigationStack {
                    TasksScreen(agent: agent)
                        .toolbar {
                            ToolbarItem(placement: .navigation) {
                                AccountMenu(onSignOut: onSignOut)
                            }
                        }
                }
            }
            Tab("履歴", systemImage: "clock.arrow.circlepath") {
                NavigationStack {
                    RunsScreen(agent: agent)
                }
            }
        }
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
    #Preview {
        MainTabs(agent: FakeAgentBackend()) {}
    }
#endif
