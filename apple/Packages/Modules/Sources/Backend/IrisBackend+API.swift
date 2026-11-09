// Every call throws `.signedOut` when the server refuses the sign-in, `.refused` with the server's message for a
// `{ message }` answer, and `.unexpected` for an answer the app does not expect.
extension IrisBackend {
    /// The user's tasks, the next to run first.
    public func tasks() async throws(AppError) -> [ScheduledTask] {
        switch try await call({ try await client.listTasks() }) {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Adds a task, and gives it back with its ID and when it runs next.
    public func addTask(_ task: NewTask) async throws(AppError) -> ScheduledTask {
        switch try await call({ try await client.addTask(body: .json(task)) }) {
        case .created(let created): return try decoded { try created.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .unsupportedMediaType(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// Removes a task; one that is already gone counts as removed. Runs it already started carry on.
    public func removeTask(id: String) async throws(AppError) {
        switch try await call({ try await client.removeTask(path: .init(taskId: id)) }) {
        case .noContent, .notFound: return
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }

    /// The user's latest runs first, as many as the server sends by default, each with its conversation.
    public func recentRuns() async throws(AppError) -> [Run] {
        switch try await call({ try await client.recentRuns() }) {
        case .ok(let ok): return try decoded { try ok.body.json }
        case .badRequest(let refused): throw try refusal { try refused.body.json }
        case .internalServerError(let failed): throw try refusal { try failed.body.json }
        case .unauthorized, .forbidden: throw .signedOut
        case .undocumented: throw .unexpected
        }
    }
}
