import Backend
import Observation

/// One agent's thread as the thread screen shows it: reading its runs, sending a message, and reading again while a
/// run is still going.
@Observable
final class AgentThread {
    /// How many of the latest runs the thread shows.
    static let runsShown = 50
    /// How often the thread is read again while one of its runs is still going.
    static let readAgainEvery: Duration = .seconds(3)

    /// The agent's latest runs, latest first. Turns to `.failed(.signedOut)` when the server refuses the sign-in, so
    /// the screen offers to sign in again.
    private(set) var runs: Loadable<[Run]> = .loading
    /// What the user is writing to the agent.
    var draft = ""
    /// Whether a message is on its way to the server.
    private(set) var isSending = false
    /// Why the last message did not go through.
    private(set) var sendProblem: AppError?

    private let backend: any AgentBackend
    // Counts the messages that went through, so a read that started before one of them is dropped.
    private var sent = 0

    init(backend: any AgentBackend) {
        self.backend = backend
    }

    /// Whether there is something written to send, and a thread to send it to.
    var canSend: Bool {
        guard case .loaded = runs, !isSending else { return false }
        return !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether the screen says why a message did not go through; setting it to false puts the problem away.
    var isShowingSendProblem: Bool {
        get { sendProblem?.message != nil }
        set { if !newValue { sendProblem = nil } }
    }

    /// Whether one of the runs shown is still going: started, or carried on, and not waiting to be tried again.
    var hasRunGoing: Bool {
        guard case .loaded(let runs) = runs else { return false }
        return runs.contains { RunStatus(of: $0) == .running }
    }

    func load() async {
        let sentBefore = sent
        let read = await runs.reading { () async throws(AppError) -> [Run] in
            try await backend.recentRuns(limit: Self.runsShown)
        }
        guard sent == sentBefore else { return }
        runs = read
    }

    /// Reads the runs again from nothing, showing that they are coming.
    @discardableResult
    func retry() -> Task<Void, Never> {
        runs = .loading
        return Task { await load() }
    }

    /// Sends what the user wrote and puts the run it starts at the end of the thread. The text goes back to the field,
    /// with the problem to show, when the server does not take it.
    @discardableResult
    func send() -> Task<Void, Never>? {
        guard canSend else { return nil }
        let text = draft
        draft = ""
        isSending = true
        sendProblem = nil
        return Task {
            defer { isSending = false }
            do throws(AppError) {
                let run = try await backend.sendMessage(text)
                sent += 1
                guard case .loaded(let runs) = runs else { return }
                self.runs = .loaded([run] + runs)
            } catch .signedOut {
                runs = .failed(.signedOut)
            } catch {
                if draft.isEmpty { draft = text }
                sendProblem = error
            }
        }
    }

    /// Reads the runs again if one of them is still going, so its reply shows when it comes.
    func readAgainIfGoing() async {
        guard hasRunGoing else { return }
        await load()
    }

    /// Reads the runs again every `readAgainEvery` while one of them is still going, until the screen goes away.
    func keepCurrent() async {
        while true {
            do {
                try await Task.sleep(for: Self.readAgainEvery)
            } catch {
                return
            }
            await readAgainIfGoing()
        }
    }
}
