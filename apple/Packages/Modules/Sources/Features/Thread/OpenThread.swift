import Backend
import Observation

/// One thread as the thread screen shows it: reading its posts and runs, sending a post with the images picked for it,
/// and keeping both current from the thread's events socket while the screen is shown.
@Observable
final class OpenThread {
    /// How many of the latest posts and runs the thread reads, the most the server gives. Replies at the oldest end
    /// whose post didn't fit are left out, so a reply is never shown without what it answers.
    static let entriesShown = 100
    /// How many images a post carries at most, the most the server takes.
    static let imagesPerPost = 4

    /// The thread's latest posts and runs, latest first. Turns to `.failed(.signedOut)` when the server refuses the
    /// sign-in, so the screen offers to sign in again.
    private(set) var entries: Loadable<[Entry]> = .loading
    /// How the runs being carried on are getting on, by run ID, as the events socket last said. A run's next state
    /// takes its place, and it is let go when the socket closes.
    private(set) var progress: [String: RunProgress] = [:]
    /// What the user is writing in the thread.
    var draft = ""
    /// The images picked for the next post, in the order picked.
    private(set) var images: [AttachedImage] = []
    /// Whether posts may carry images, as the server said; false until it says.
    private(set) var canAttachImages = false
    /// Whether a post is on its way to the server.
    private(set) var isSending = false
    /// Why the last post did not go through.
    private(set) var sendProblem: AppError?

    private let backend: any ThreadBackend
    private let wait: @Sendable (Duration) async throws -> Void
    private let now: () -> ContinuousClock.Instant
    /// A post or run that came while a read was on its way: heard on the socket, which replaces what is shown, or
    /// answered to a send, which only adds what is missing.
    private enum Arrival {
        case heard(Entry)
        case sent(Entry)
    }

    // Posts and runs that came while a read was on its way, in order, put back on top of what the read brings.
    private var cameDuringRead: [Arrival] = []
    private var readsOnTheWay = 0
    // When the socket being followed opened; nil while it hasn't.
    private var openedAt: ContinuousClock.Instant?

    /// `wait` sleeps before the socket is opened again (`Task.sleep` by default); `now` tells how long it stayed open.
    init(
        backend: any ThreadBackend,
        wait: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping () -> ContinuousClock.Instant = { .now }
    ) {
        self.backend = backend
        self.wait = wait
        self.now = now
    }

    /// Whether there is something written or an image to send, a thread to send it to, and every image picked is put
    /// up.
    var canSend: Bool {
        guard case .loaded = entries, !isSending, images.count <= Self.imagesPerPost,
            images.allSatisfy({ $0.uploadedID != nil })
        else { return false }
        return !images.isEmpty || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// How many more images the next post can take; none while posts may not carry images.
    var imagesLeft: Int {
        canAttachImages ? max(Self.imagesPerPost - images.count, 0) : 0
    }

    /// Asks the server whether posts may carry images. When it can't say, they stay without.
    func checkImageAttaching() async {
        do throws(AppError) {
            canAttachImages = try await backend.canAttachImages()
        } catch {
            canAttachImages = false
        }
    }

    /// Adds the images picked, as many as the post has room for, and starts putting each up. The task ends once every
    /// one is put up or failed.
    @discardableResult
    func attach(_ picked: [any PickedImage]) -> Task<Void, Never> {
        let added = picked.prefix(imagesLeft).map { AttachedImage(picked: $0, backend: backend) }
        images += added
        let work = added.map { $0.start() }
        return Task {
            for task in work { await task.value }
        }
    }

    /// Takes the image off the next post.
    func remove(_ image: AttachedImage) {
        image.cancel()
        images.removeAll { $0 === image }
    }

    /// Whether the screen says why a message did not go through; setting it to false puts the problem away.
    var isShowingSendProblem: Bool {
        get { sendProblem?.message != nil }
        set { if !newValue { sendProblem = nil } }
    }

    /// Reads the latest posts and runs. Those that come from the socket or a send while the read is on its way stay as
    /// they came, and a read that fails leaves the thread as it is by then.
    func load() async {
        readsOnTheWay += 1
        let first = cameDuringRead.count
        let result: Result<[Entry], AppError>
        do throws(AppError) {
            result = .success(Self.whole(try await backend.entries(limit: Self.entriesShown).map(Entry.init)))
        } catch {
            result = .failure(error)
        }
        readsOnTheWay -= 1
        entries = entries.applying(result)
        if case .success = result {
            for arrival in cameDuringRead[first...] {
                switch arrival {
                case .heard(let entry): place(entry)
                case .sent(let entry): placeIfMissing(entry)
                }
            }
        }
        if readsOnTheWay == 0 { cameDuringRead = [] }
    }

    /// Reads the thread again from nothing, showing that it is coming.
    @discardableResult
    func retry() -> Task<Void, Never> {
        entries = .loading
        return Task { await load() }
    }

    /// Sends what the user wrote with the images put up, and puts the post and the runs it starts in the thread, unless
    /// the socket brought them first, as it does when it is open: the socket's are the newer. When the server does not
    /// take it, the text goes back to the field and the images to the bar, before anything added since, with the problem
    /// to show.
    @discardableResult
    func send() -> Task<Void, Never>? {
        guard canSend else { return nil }
        let text = draft
        let sentImages = images
        draft = ""
        images = []
        isSending = true
        sendProblem = nil
        return Task {
            defer { isSending = false }
            do throws(AppError) {
                let sent = try await backend.send(text, attaching: sentImages.compactMap(\.uploadedID))
                for entry in [Entry.post(sent.post)] + sent.runs.map(Entry.run) {
                    if readsOnTheWay > 0 { cameDuringRead.append(.sent(entry)) }
                    placeIfMissing(entry)
                }
            } catch {
                draft = draft.isEmpty ? text : "\(text)\n\(draft)"
                images = sentImages + images
                if error == .signedOut {
                    entries = .failed(.signedOut)
                } else {
                    sendProblem = error
                }
            }
        }
    }

    /// Takes in what the events socket says: a run as it is now, how one is getting on, or a post sent.
    func hear(_ event: RunEvent) {
        switch event {
        case .case1(let changed):
            progress[changed.run.id] = nil
            heard(.run(changed.run))
        case .case2(let getting):
            progress[getting.runId] = getting.progress
        case .case3(let posted):
            heard(.post(posted.post))
        }
    }

    private func heard(_ entry: Entry) {
        if readsOnTheWay > 0 { cameDuringRead.append(.heard(entry)) }
        place(entry)
    }

    /// Reads the thread and keeps it current while the screen shows it. It opens the thread's events socket and reads
    /// the thread once it is open, since nothing from before then comes on it, or reads them through `/api` when it
    /// can't open. After the socket closes or fails, it opens it again, waiting longer after each failure in a row; a
    /// socket that stayed open `SocketReopening.openLongEnough` starts the count over. It stops when the screen goes
    /// away, and opens no more sockets once the sign-in ends.
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
                entries = .failed(.signedOut)
                return
            } catch {
                // Counted below, by how long the socket stayed open.
            }
            // The socket also closes when the screen goes away; that is no reason to open it again.
            if Task.isCancelled { return }
            if let openedAt, now() - openedAt >= SocketReopening.openLongEnough {
                failures = 0
            } else {
                failures += 1
                // Reading through /api keeps the thread current while the socket can't open, and ends a sign-in the
                // server no longer accepts, should the socket's refusal not have said so.
                await load()
                if case .failed(.signedOut) = entries { return }
            }
            progress = [:]
            do {
                try await wait(SocketReopening.delay(afterFailures: failures))
            } catch {
                return
            }
        }
    }

    private func opened() async {
        openedAt = now()
        await load()
    }

    /// Puts the post or run in the thread unless one with its ID is there.
    private func placeIfMissing(_ entry: Entry) {
        guard case .loaded(let shown) = entries, !shown.contains(where: { $0.id == entry.id }) else { return }
        place(entry)
    }

    /// Puts the post or run in the thread, latest first, in place of what was there, keeping the latest
    /// `entriesShown`.
    private func place(_ entry: Entry) {
        guard case .loaded(var shown) = entries else { return }
        if let index = shown.firstIndex(where: { $0.id == entry.id }) {
            shown[index] = entry
        } else {
            shown.insert(entry, at: shown.firstIndex { entry.isLater(than: $0) } ?? shown.endIndex)
        }
        // Cutting the oldest end may leave replies without their post; a run that only came before its post is kept.
        entries = .loaded(shown.count > Self.entriesShown ? Self.whole(Array(shown.prefix(Self.entriesShown))) : shown)
    }

    /// The entries, latest first, without the replies at the oldest end whose post isn't among them.
    private static func whole(_ entries: [Entry]) -> [Entry] {
        var kept = entries
        while let oldest = kept.last, oldest.repliesToNone(of: kept) {
            kept.removeLast()
        }
        return kept
    }
}
