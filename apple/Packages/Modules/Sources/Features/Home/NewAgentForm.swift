import Backend
import Observation

/// The name the user writes for a new agent, and sending it.
@Observable
final class NewAgentForm {
    /// The longest name the server takes, in UTF-16 code units after trimming.
    static let maxNameLength = 40

    var name = ""
    private(set) var isAdding = false
    /// Why the last try did not go through.
    private(set) var problem: AppError?

    private let directory: any AgentDirectory

    init(directory: any AgentDirectory) {
        self.directory = directory
    }

    var canAdd: Bool { !isAdding && !trimmedName.isEmpty && trimmedName.utf16.count <= Self.maxNameLength }

    /// Sends the name, and gives back the work, which calls `onAdded` with the agent once the server has it, or
    /// `onSignedOut` when the server refuses the sign-in. Does nothing while the name is empty or too long, or an agent
    /// is already being sent.
    @discardableResult
    func add(onAdded: @escaping (Agent) -> Void, onSignedOut: @escaping () -> Void) -> Task<Void, Never> {
        guard canAdd else { return Task {} }
        isAdding = true
        problem = nil
        let name = trimmedName
        return Task {
            do throws(AppError) {
                onAdded(try await directory.addAgent(named: name))
            } catch .signedOut {
                isAdding = false
                onSignedOut()
            } catch {
                problem = error
                isAdding = false
            }
        }
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}
