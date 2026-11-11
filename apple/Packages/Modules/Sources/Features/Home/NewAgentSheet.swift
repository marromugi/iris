import Backend
import SwiftUI

/// Naming a new agent.
struct NewAgentSheet: View {
    @State private var form: NewAgentForm
    let onAdded: (Agent) -> Void
    let onSignedOut: () -> Void
    @Environment(\.dismiss) private var dismiss

    init(directory: any AgentDirectory, onAdded: @escaping (Agent) -> Void, onSignedOut: @escaping () -> Void) {
        _form = State(initialValue: NewAgentForm(directory: directory))
        self.onAdded = onAdded
        self.onSignedOut = onSignedOut
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 16) {
                        AgentOrb(look: form.look, size: 120)
                        Button("ほかの色にする", systemImage: "shuffle") { form.shuffle() }
                            .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                Section {
                    TextField("例：株価の確認", text: $form.name)
                        .onSubmit(add)
                } header: {
                    Text("名前")
                } footer: {
                    Text("\(NewAgentForm.maxNameLength) 文字までです。")
                }
                if let problem = form.problem?.message {
                    Section {
                        Text(problem)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("エージェントを追加")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                        .disabled(form.isAdding)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(form.isAdding ? "追加中…" : "追加", action: add)
                        .disabled(!form.canAdd)
                }
            }
            .interactiveDismissDisabled(form.isAdding)
        }
    }

    private func add() {
        form.add(
            onAdded: { agent in
                onAdded(agent)
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
        NewAgentSheet(directory: FakeAgentDirectory(), onAdded: { _ in }, onSignedOut: {})
    }

    #Preview("追加できない") {
        NewAgentSheet(directory: FakeAgentDirectory(failure: .offline), onAdded: { _ in }, onSignedOut: {})
    }
#endif
