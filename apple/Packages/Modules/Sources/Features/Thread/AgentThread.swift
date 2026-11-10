import Backend
import Observation

/// One agent's thread as the thread screen shows it: reading its runs, sending a message, and keeping both current from
/// the agent's events socket while the screen is shown.
@Observable
final class AgentThread {
    /// How many of the latest runs the thread shows.
    static let runsShown = 50

    /// How long to wait before opening the events socket again: a second after the server closed it, and twice as
    /// long after each failure in a row, up to 30 seconds.
    static func reopenDelay(afterFailures failures: Int) -> Duration {
        .seconds(min(30, 1 << min(failures, 5)))
    }

    /// The agent's latest runs, latest first. Turns to `.failed(.signedOut)` when the server refuses the sign-in, so
    /// the screen offers to sign in again.
    private(set) var runs: Loadable<[Run]> = .loading
    /// How the runs being carried on are getting on, by run ID, as the events socket last said. A run's next state
    /// takes its place, and it is let go when the socket closes.
    private(set) var progress: [String: RunProgress] = [:]
    /// What the user is writing to the agent.
    var draft = ""
    /// Whether a message is on its way to the server.
    private(set) var isSending = false
    /// Why the last message did not go through.
    private(set) var sendProblem: AppError?

    private let backend: any AgentBackend
    private let wait: @Sendable (Duration) async throws -> Void
    // Runs that came while a read was on its way, in order, put back on top of what the read brings.
    private var cameDuringRead: [Run] = []
    private var readsOnTheWay = 0

    /// `wait` sleeps before the socket is opened again (`Task.sleep` by default).
    init(
        backend: any AgentBackend,
        wait: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.backend = backend
        self.wait = wait
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

    /// Reads the latest runs. Runs that come from the socket or a send while the read is on its way stay as they came.
    func load() async {
        readsOnTheWay += 1
        let first = cameDuringRead.count
        let read = await runs.reading { () async throws(AppError) -> [Run] in
            try await backend.recentRuns(limit: Self.runsShown)
        }
        readsOnTheWay -= 1
        runs = read
        for run in cameDuringRead[first...] {
            put(run)
        }
        if readsOnTheWay == 0 { cameDuringRead = [] }
    }

    /// Reads the runs again from nothing, showing that they are coming.
    @discardableResult
    func retry() -> Task<Void, Never> {
        runs = .loading
        return Task { await load() }
    }

    /// Sends what the user wrote and puts the run it starts in the thread. When the server does not take it, the text
    /// goes back to the field, before anything written since, with the problem to show.
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
                put(try await backend.sendMessage(text))
            } catch {
                draft = draft.isEmpty ? text : "\(text)\n\(draft)"
                if error == .signedOut {
                    runs = .failed(.signedOut)
                } else {
                    sendProblem = error
                }
            }
        }
    }

    /// Takes in what the events socket says: a run as it is now, or how one is getting on.
    func hear(_ event: RunEvent) {
        switch event {
        case .case1(let changed):
            put(changed.run)
        case .case2(let getting):
            progress[getting.runId] = getting.progress
        }
    }

    /// Keeps the thread current while the screen shows it. It opens the agent's events socket and reads the runs once
    /// it is open, since nothing from before then comes on it. After the socket closes or fails, it opens it again,
    /// waiting longer after each failure in a row. It stops when the screen goes away or the sign-in ends.
    func follow() async {
        var failures = 0
        while !Task.isCancelled {
            do throws(AppError) {
                try await backend.followEvents {
                    await self.load()
                } onEvent: { event in
                    await self.hear(event)
                }
                failures = 0
            } catch .cancelled {
                return
            } catch .signedOut {
                runs = .failed(.signedOut)
                return
            } catch {
                failures += 1
            }
            // The socket also closes when the screen goes away; that is no reason to open it again.
            if Task.isCancelled { return }
            progress = [:]
            do {
                try await wait(Self.reopenDelay(afterFailures: failures))
            } catch {
                return
            }
        }
    }

    /// Puts the run in its place among the runs, latest first, in place of what was there; its progress is over.
    private func put(_ run: Run) {
        progress[run.id] = nil
        if readsOnTheWay > 0 { cameDuringRead.append(run) }
        guard case .loaded(var shown) = runs else { return }
        if let index = shown.firstIndex(where: { $0.id == run.id }) {
            shown[index] = run
        } else {
            shown.insert(run, at: shown.firstIndex { $0.startedAt < run.startedAt } ?? shown.endIndex)
        }
        runs = .loaded(shown)
    }
}
