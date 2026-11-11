import Backend
import SwiftUI

/// Naming a new group and choosing its agents.
struct NewGroupSheet: View {
    @State private var form: NewGroupForm
    let onAdded: (ChatThread) -> Void
    let onSignedOut: () -> Void
    @Environment(\.dismiss) private var dismiss

    init(
        directory: any AgentDirectory, agents: [Agent], onAdded: @escaping (ChatThread) -> Void,
        onSignedOut: @escaping () -> Void
    ) {
        _form = State(initialValue: NewGroupForm(directory: directory, agents: agents))
        self.onAdded = onAdded
        self.onSignedOut = onSignedOut
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("名前") {
                    TextField("例：朝のチーム", text: $form.name)
                }
                Section {
                    ForEach(form.agents) { agent in
                        Toggle(agent.name, isOn: memberBinding(agent.id))
                    }
                } header: {
                    Text("メンバー")
                } footer: {
                    Text("\(NewGroupForm.fewestMembers) 体以上選んでください。")
                }
                if let problem = form.problem?.message {
                    Section {
                        Text(problem)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("グループを作成")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                        .disabled(form.isAdding)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(form.isAdding ? "作成中…" : "作成", action: add)
                        .disabled(!form.canAdd)
                }
            }
            .interactiveDismissDisabled(form.isAdding)
        }
    }

    private func memberBinding(_ id: Agent.ID) -> Binding<Bool> {
        Binding(
            get: { form.members.contains(id) },
            set: { isMember in
                if isMember { form.members.insert(id) } else { form.members.remove(id) }
            })
    }

    private func add() {
        form.add(
            onAdded: { thread in
                onAdded(thread)
                dismiss()
            },
            onSignedOut: {
                onSignedOut()
                dismiss()
            }
        )
    }
}

#if DEBUG
    #Preview {
        NewGroupSheet(
            directory: FakeAgentDirectory(), agents: Array(Samples.agents.prefix(4)), onAdded: { _ in }, onSignedOut: {})
    }
#endif
