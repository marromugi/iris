import Backend
import Observation

/// One agent's thread as the thread screen shows it: reading its runs, sending a message, and keeping both current from
/// the agent's events socket while the screen is shown.
@Observable
final class AgentThread {
    /// How many of the latest runs the thread shows.
    static let runsShown = 50

    /// How long to wait before opening the events socket again: a second after one that stayed open, and twice as long
    /// after each failure in a row, up to 30 seconds.
    static func reopenDelay(afterFailures failures: Int) -> Duration {
        .seconds(min(30, 1 << min(failures, 5)))
    }

    /// How long the socket has to stay open for its end not to count as a failure. A socket that fails to open, or
    /// closes sooner, counts as one.
    static let openLongEnough: Duration = .seconds(10)

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
    private let now: () -> ContinuousClock.Instant
    /// A run that came while a read was on its way: heard on the socket, which replaces what is shown, or answered to a
    /// send, which only adds what is missing.
    private enum Arrival {
        case heard(Run)
        case sent(Run)
    }

    // Runs that came while a read was on its way, in order, put back on top of what the read brings.
    private var cameDuringRead: [Arrival] = []
    private var readsOnTheWay = 0
    // When the socket being followed opened; nil while it hasn't.
    private var openedAt: ContinuousClock.Instant?

    /// `wait` sleeps before the socket is opened again (`Task.sleep` by default); `now` tells how long it stayed open.
    init(
        backend: any AgentBackend,
        wait: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> ContinuousClock.Instant = { .now }
    ) {
        self.backend = backend
        self.wait = wait
        self.now = now
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

    /// Reads the latest runs. Runs that come from the socket or a send while the read is on its way stay as they came,
    /// and a read that fails leaves the runs as they are by then.
    func load() async {
        readsOnTheWay += 1
        let first = cameDuringRead.count
        let result: Result<[Run], AppError>
        do throws(AppError) {
            result = .success(try await backend.recentRuns(limit: Self.runsShown))
        } catch {
            result = .failure(error)
        }
        readsOnTheWay -= 1
        runs = runs.applying(result)
        if case .success = result {
            for arrival in cameDuringRead[first...] {
                switch arrival {
                case .heard(let run): place(run)
                case .sent(let run): placeIfMissing(run)
                }
            }
        }
        if readsOnTheWay == 0 { cameDuringRead = [] }
    }

    /// Reads the runs again from nothing, showing that they are coming.
    @discardableResult
    func retry() -> Task<Void, Never> {
        runs = .loading
        return Task { await load() }
    }

    /// Sends what the user wrote and puts the run it starts in the thread, unless the socket brought it first, as it
    /// does when it is open: the socket's is the newer. When the server does not take it, the text goes back to the
    /// field, before anything written since, with the problem to show.
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
                if readsOnTheWay > 0 { cameDuringRead.append(.sent(run)) }
                placeIfMissing(run)
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
            progress[changed.run.id] = nil
            if readsOnTheWay > 0 { cameDuringRead.append(.heard(changed.run)) }
            place(changed.run)
        case .case2(let getting):
            progress[getting.runId] = getting.progress
        case .case3:
            // Posts come only on a thread's socket, not the agent's this screen opens.
            break
        }
    }

    /// Reads the runs and keeps the thread current while the screen shows it. It opens the agent's events socket and
    /// reads the runs once it is open, since nothing from before then comes on it, or reads them through `/api` when it
    /// can't open. After the socket closes or fails, it opens it again, waiting longer after each failure in a row; a
    /// socket that stayed open `openLongEnough` starts the count over. It stops when the screen goes away, and opens
    /// no more sockets once the sign-in ends.
    func follow() async {
        var failures = 0
        while !Task.isCancelled {
            openedAt = nil
            do throws(AppError) {
                try await backend.followEvents {
                    await self.opened()
                } onEvent: { event in
                    await self.hear(event)
                }
            } catch .cancelled {
                return
            } catch .signedOut {
                runs = .failed(.signedOut)
                return
            } catch {
                // Counted below, by how long the socket stayed open.
            }
            // The socket also closes when the screen goes away; that is no reason to open it again.
            if Task.isCancelled { return }
            if let openedAt, now() - openedAt >= Self.openLongEnough {
                failures = 0
            } else {
                failures += 1
                // Reading through /api keeps the thread current while the socket can't open, and ends a sign-in the
                // server no longer accepts, should the socket's refusal not have said so.
                await load()
                if case .failed(.signedOut) = runs { return }
            }
            progress = [:]
            do {
                try await wait(Self.reopenDelay(afterFailures: failures))
            } catch {
                return
            }
        }
    }

    private func opened() async {
        openedAt = now()
        await load()
    }

    /// Puts the run among the runs unless one with its ID is there.
    private func placeIfMissing(_ run: Run) {
        guard case .loaded(let shown) = runs, !shown.contains(where: { $0.id == run.id }) else { return }
        place(run)
    }

    /// Puts the run among the runs, latest first, in place of what was there, keeping the latest `runsShown`.
    private func place(_ run: Run) {
        guard case .loaded(var shown) = runs else { return }
        if let index = shown.firstIndex(where: { $0.id == run.id }) {
            shown[index] = run
        } else {
            shown.insert(run, at: shown.firstIndex { $0.startedAt < run.startedAt } ?? shown.endIndex)
        }
        runs = .loaded(Array(shown.prefix(Self.runsShown)))
    }
}
