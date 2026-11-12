// Every call throws `.signedOut` when the server refuses the sign-in, `.refused` with the server's message for a
// `{ message }` answer (an agent the user does not have among them), and `.unexpected` for an answer the app does not
// expect.
extension IrisBackend {
    /// The user's agents in the order they were added.
    public func agents() async throws(AppError) -> [Agent] {
        switch try await call({ try await client.listAgents() }) {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Adds an agent with the name and look, and gives it back as the list will show it, last.
    public func addAgent(named name: String, look: AgentLook) async throws(AppError) -> Agent {
        switch try await call({ try await client.addAgent(body: .json(NewAgent(name: name, look: look))) }) {
        case .created(let created): return try decoded { try created.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .unsupportedMediaType(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// The agent's tasks, the next to run first.
    public func tasks(of agentID: Agent.ID) async throws(AppError) -> [ScheduledTask] {
        switch try await call({ try await client.listTasks(path: .init(agentId: agentID)) }) {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .notFound(let refused): throw try refusal { try refused.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Adds a task to the agent, and gives it back with its ID and when it runs next.
    public func addTask(_ task: NewTask, to agentID: Agent.ID) async throws(AppError) -> ScheduledTask {
        switch try await call({ try await client.addTask(path: .init(agentId: agentID), body: .json(task)) }) {
        case .created(let created): return try decoded { try created.body.json }
        case .notFound(let refused): throw try refusal { try refused.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .unsupportedMediaType(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Removes one of the agent's tasks; one that is already gone, or whose agent is, counts as removed. Runs it
    /// already started carry on.
    public func removeTask(id: String, of agentID: Agent.ID) async throws(AppError) {
        switch try await call({ try await client.removeTask(path: .init(agentId: agentID, taskId: id)) }) {
        case .noContent, .notFound: return
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Deactivates the agent: it replies to nothing and its tasks don't run until it is activated, and nothing it has
    /// is removed.
    public func deactivate(_ agentID: Agent.ID) async throws(AppError) {
        switch try await call({ try await client.deactivateAgent(path: .init(agentId: agentID)) }) {
        case .noContent: return
        case .notFound(let missing): throw try refusal { try missing.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Activates the agent again. Its tasks next run at their first time after now.
    public func activate(_ agentID: Agent.ID) async throws(AppError) {
        switch try await call({ try await client.activateAgent(path: .init(agentId: agentID)) }) {
        case .noContent: return
        case .notFound(let missing): throw try refusal { try missing.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Sets the time zone the user's days are read in, as an IANA identifier such as Asia/Tokyo. The server refuses one
    /// it doesn't know.
    public func setTimeZone(_ identifier: String) async throws(AppError) {
        switch try await call({ try await client.setTimeZone(body: .json(.init(timeZone: identifier))) }) {
        case .noContent: return
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .unsupportedMediaType(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// The user's threads, each agent's one-to-one thread and the groups together, the latest activity first.
    public func threads() async throws(AppError) -> [ChatThread] {
        switch try await call({ try await client.listThreads() }) {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Makes a group of the agents with the name, and gives it back as the home lists it.
    public func addGroup(named name: String, of agentIDs: [Agent.ID]) async throws(AppError) -> ChatThread {
        switch try await call({ try await client.addGroup(body: .json(NewGroup(name: name, agentIds: agentIDs))) }) {
        case .created(let created): return try decoded { try created.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .unsupportedMediaType(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// The thread's latest `limit` posts and runs together, latest first. The server takes 1 to 100.
    public func entries(of threadID: ChatThread.ID, limit: Int) async throws(AppError) -> [ThreadEntry] {
        switch try await call({
            try await client.threadEntries(path: .init(threadId: threadID), query: .init(limit: limit))
        }) {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .notFound(let refused): throw try refusal { try refused.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Sends a post in the thread, and gives back the post and the runs that reply to it as they start.
    public func sendPost(_ text: String, to threadID: ChatThread.ID) async throws(AppError) -> SentPost {
        switch try await call({
            try await client.sendPost(path: .init(threadId: threadID), body: .json(NewMessage(text: text)))
        }) {
        case .accepted(let accepted): return try decoded { try accepted.body.json }
        case .notFound(let refused): throw try refusal { try refused.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .unsupportedMediaType(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }
}
