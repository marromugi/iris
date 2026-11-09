import Backend
import Observation

/// The user's tasks as the tasks screen shows them: reading them, adding one, and removing one.
@Observable
final class TaskList {
    /// The tasks, the next to run first. Turns to `.failed(.signedOut)` when the server refuses the sign-in, so the
    /// screen offers to sign in again.
    private(set) var tasks: Loadable<[ScheduledTask]> = .loading
    /// The IDs of tasks being removed, kept off the screen until the server answers.
    private(set) var removing: Set<String> = []
    /// Why the last removal did not go through.
    private(set) var removalProblem: AppError?

    private let backend: any AgentBackend
    // Counts the adds and removals that went through, so a read that started before one of them is dropped.
    private var changes = 0

    init(backend: any AgentBackend) {
        self.backend = backend
    }

    /// The tasks to show: those read, without the ones being removed.
    var shown: Loadable<[ScheduledTask]> {
        guard case .loaded(let tasks) = tasks else { return tasks }
        return .loaded(tasks.filter { !removing.contains($0.id) })
    }

    /// Whether the screen says why a removal did not go through; setting it to false puts the problem away.
    var isShowingRemovalProblem: Bool {
        get { removalProblem?.message != nil }
        set { if !newValue { removalProblem = nil } }
    }

    /// Whether the tasks were read, so there is a list to add to.
    var isLoaded: Bool {
        if case .loaded = tasks { true } else { false }
    }

    func load() async {
        let changesBefore = changes
        let read = await tasks.reading { () async throws(AppError) -> [ScheduledTask] in try await backend.tasks() }
        guard changes == changesBefore else { return }
        tasks = read
    }

    /// Reads the tasks again from nothing, showing that they are coming.
    @discardableResult
    func retry() -> Task<Void, Never> {
        tasks = .loading
        return Task { await load() }
    }

    /// Sends a new task and puts it in its place in the list.
    func add(_ task: NewTask) async throws(AppError) {
        do throws(AppError) {
            let added = try await backend.addTask(task)
            changes += 1
            guard case .loaded(let tasks) = tasks else { return }
            self.tasks = .loaded((tasks + [added]).sorted { $0.nextRunAt < $1.nextRunAt })
        } catch {
            if error == .signedOut { tasks = .failed(.signedOut) }
            throw error
        }
    }

    /// Takes the task off the screen and asks the server to remove it. It comes back, with the problem to show, when
    /// the server does not remove it.
    @discardableResult
    func remove(_ task: ScheduledTask) -> Task<Void, Never> {
        removing.insert(task.id)
        removalProblem = nil
        return Task {
            defer { removing.remove(task.id) }
            do throws(AppError) {
                try await backend.removeTask(id: task.id)
                changes += 1
                guard case .loaded(let tasks) = tasks else { return }
                self.tasks = .loaded(tasks.filter { $0.id != task.id })
            } catch .signedOut {
                tasks = .failed(.signedOut)
            } catch {
                removalProblem = error
            }
        }
    }
}
