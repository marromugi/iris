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

    /// The agent's latest `limit` runs, latest first, each with its conversation. The server takes 1 to 100.
    public func recentRuns(of agentID: Agent.ID, limit: Int) async throws(AppError) -> [Run] {
        switch try await call({ try await client.recentRuns(path: .init(agentId: agentID), query: .init(limit: limit)) })
        {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .notFound(let refused): throw try refusal { try refused.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }
}
