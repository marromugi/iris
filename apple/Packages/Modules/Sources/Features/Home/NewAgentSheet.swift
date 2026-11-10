import Backend
import SwiftUI

/// Naming a new agent.
struct NewAgentSheet: View {
    @State private var form: NewAgentForm
    let onAdded: (Agent) -> Void
    @Environment(\.dismiss) private var dismiss

    init(directory: any AgentDirectory, onAdded: @escaping (Agent) -> Void) {
        _form = State(initialValue: NewAgentForm(directory: directory))
        self.onAdded = onAdded
    }

    var body: some View {
        NavigationStack {
            Form {
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
        form.add { agent in
            onAdded(agent)
            dismiss()
        }
    }
}

#if DEBUG
    #Preview {
        NewAgentSheet(directory: FakeAgentDirectory()) { _ in }
    }

    #Preview("追加できない") {
        NewAgentSheet(directory: FakeAgentDirectory(failure: .offline)) { _ in }
    }
#endif
