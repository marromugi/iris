// The server's types as the app reads them, under names that say what they are in the app. They are the generated
// ones, since openapi.json is the server's contract.

/// A task the user's agent runs on its schedule, with when it runs next. Not `Task`, which is Swift's own.
public typealias ScheduledTask = Components.Schemas.Task
/// What adding a task sends: the prompt each run starts with, and when it runs.
public typealias NewTask = Components.Schemas.NewTask
/// One run of a task: when it started and ended, how its attempts went, and its conversation.
public typealias Run = Components.Schemas.Run
/// One message of a run's conversation: the user's prompt, the assistant's answer, or a tool's result.
public typealias RunMessage = Components.Schemas.Message
