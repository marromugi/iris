import Backend
import Observation

/// Whether an agent is active, as its one-to-one thread shows it, and switching it: deactivating stops it replying
/// and running its tasks, activating lets it again. Nothing it has is removed either way.
@Observable
final class AgentActivity {
    private(set) var isActive: Bool
    /// Whether a switch was sent and the server hasn't answered yet.
    private(set) var isSwitching = false
    /// Why the last switch did not go through.
    private(set) var problem: AppError?

    private let backend: any AgentBackend
    private let onSwitched: () -> Void

    /// `onSwitched` is called once the server has switched the agent, so what lists it can read it again.
    init(backend: any AgentBackend, isActive: Bool, onSwitched: @escaping () -> Void) {
        self.backend = backend
        self.isActive = isActive
        self.onSwitched = onSwitched
    }

    /// Whether the screen says why a switch did not go through; setting it to false puts the problem away.
    var isShowingProblem: Bool {
        get { problem?.message != nil }
        set { if !newValue { problem = nil } }
    }

    @discardableResult
    func deactivate() -> Task<Void, Never> {
        switchTo(active: false)
    }

    @discardableResult
    func activate() -> Task<Void, Never> {
        switchTo(active: true)
    }

    private func switchTo(active: Bool) -> Task<Void, Never> {
        isSwitching = true
        problem = nil
        return Task {
            defer { isSwitching = false }
            do throws(AppError) {
                if active {
                    try await backend.activate()
                } else {
                    try await backend.deactivate()
                }
                isActive = active
                onSwitched()
            } catch {
                problem = error
            }
        }
    }
}
