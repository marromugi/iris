import Backend
import SwiftUI

/// The user's tasks, the next to run first: when each runs, adding one, and removing one with a swipe.
struct TasksScreen: View {
    @State private var list: TaskList
    @State private var isAddingTask = false

    init(agent: any AgentBackend) {
        _list = State(initialValue: TaskList(backend: agent))
    }

    var body: some View {
        LoadableContent(state: list.shown, onRetry: { list.retry() }) { tasks in
            List(tasks, id: \.id) { task in
                TaskRow(task: task)
                    .swipeActions {
                        Button("削除", systemImage: "trash", role: .destructive) { list.remove(task) }
                    }
            }
            .overlay {
                if tasks.isEmpty {
                    NoTasksView { isAddingTask = true }
                }
            }
            .refreshable { await list.load() }
        }
        .navigationTitle("タスク")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("タスクを追加", systemImage: "plus") { isAddingTask = true }
                    .disabled(!list.isLoaded)
            }
        }
        .sheet(isPresented: $isAddingTask) {
            NewTaskSheet(list: list)
        }
        .alert("削除できませんでした", isPresented: $list.isShowingRemovalProblem, presenting: list.removalProblem) { _ in
            Button("OK") {}
        } message: { problem in
            Text(problem.message ?? "")
        }
        .task { await list.load() }
    }
}

/// One task: its prompt, when it runs, and when it runs next.
private struct TaskRow: View {
    let task: ScheduledTask

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(task.prompt)
                .lineLimit(3)
            Text(ScheduleText.of(task.schedule))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text("次回 \(DateText.moment(task.nextRunAt))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// No tasks yet, and the way to add the first.
private struct NoTasksView: View {
    let onAdd: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("タスクはまだありません", systemImage: "checklist")
        } description: {
            Text("毎日決まった時刻に、エージェントに頼むことを足せます。")
        } actions: {
            Button("タスクを追加", action: onAdd)
        }
    }
}

#if DEBUG
    #Preview("タスクあり") {
        NavigationStack {
            TasksScreen(agent: FakeAgentBackend())
        }
    }

    #Preview("タスクなし") {
        NavigationStack {
            TasksScreen(agent: FakeAgentBackend(.init(tasks: [])))
        }
    }

    #Preview("読み込めない") {
        NavigationStack {
            TasksScreen(agent: FakeAgentBackend(.init(failure: .offline)))
        }
    }
#endif
