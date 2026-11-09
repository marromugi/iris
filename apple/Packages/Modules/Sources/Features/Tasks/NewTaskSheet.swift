import SwiftUI

/// Writing a new task: what to ask the agent, and the time of day it runs every day.
struct NewTaskSheet: View {
    @State private var form: NewTaskForm
    @Environment(\.dismiss) private var dismiss

    init(list: TaskList) {
        _form = State(initialValue: NewTaskForm(list: list))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("頼むこと") {
                    TextField("例：今日の予定を短くまとめて", text: $form.prompt, axis: .vertical)
                        .lineLimit(3...10)
                }
                Section {
                    DatePicker("時刻", selection: $form.timeOfDay, displayedComponents: .hourAndMinute)
                } header: {
                    Text("毎日動く時刻")
                } footer: {
                    Text("\(form.timeZone.identifier) の時刻です。")
                }
                if let problem = form.problem?.message {
                    Section {
                        Text(problem)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("タスクを追加")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                        .disabled(form.isAdding)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(form.isAdding ? "追加中…" : "追加") { form.add { dismiss() } }
                        .disabled(!form.canAdd)
                }
            }
            .interactiveDismissDisabled(form.isAdding)
        }
    }
}

#if DEBUG
    #Preview {
        NewTaskSheet(list: TaskList(backend: FakeAgentBackend()))
    }
#endif
