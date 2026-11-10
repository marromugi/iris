import Backend
import Observation

/// The name and members the user picks for a new group, and sending them.
@Observable
final class NewGroupForm {
    /// The fewest members a group has.
    static let fewestMembers = 2

    var name = ""
    /// The chosen agents' IDs.
    var members: Set<Agent.ID> = []
    private(set) var isAdding = false
    /// Why the last try did not go through.
    private(set) var problem: AppError?

    private let directory: any AgentDirectory
    /// The agents to choose from, in the order they are offered, which is the order the members are sent in.
    let agents: [Agent]

    init(directory: any AgentDirectory, agents: [Agent]) {
        self.directory = directory
        self.agents = agents
    }

    var canAdd: Bool {
        !isAdding && !trimmedName.isEmpty && trimmedName.utf16.count <= NewAgentForm.maxNameLength
            && members.count >= Self.fewestMembers
    }

    /// Sends the group, and gives back the work, which calls `onAdded` with it once the server has it, or `onSignedOut`
    /// when the server refuses the sign-in. Does nothing until there is a name and enough members, or while a group is
    /// already being sent.
    @discardableResult
    func add(onAdded: @escaping (ChatThread) -> Void, onSignedOut: @escaping () -> Void) -> Task<Void, Never> {
        guard canAdd else { return Task {} }
        isAdding = true
        problem = nil
        let name = trimmedName
        let chosen = agents.map(\.id).filter(members.contains)
        return Task {
            do throws(AppError) {
                onAdded(try await directory.addGroup(named: name, of: chosen))
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
