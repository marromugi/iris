// The server's types as the app reads them, under names that say what they are in the app. They are the generated
// ones, since openapi.json is the server's contract.

/// One of the user's agents: what it is called, and when its latest run started (nil until it first runs).
public typealias Agent = Components.Schemas.Agent
/// A task an agent runs on its schedule, with when it runs next. Not `Task`, which is Swift's own.
public typealias ScheduledTask = Components.Schemas.Task
/// What adding a task sends: the prompt each run starts with, and when it runs.
public typealias NewTask = Components.Schemas.NewTask
/// What sending a message to an agent sends: the text the run it starts begins with.
public typealias NewMessage = Components.Schemas.NewMessage
/// One run of an agent, started by a task or by a message sent to it: when it started and ended, how its attempts
/// went, and its conversation.
public typealias Run = Components.Schemas.Run
/// One message of a run's conversation: the user's prompt, the assistant's answer, or a tool's result.
public typealias RunMessage = Components.Schemas.Message
/// What an agent's events socket sends: a run as it is now, or how the run being carried on is getting on.
public typealias RunEvent = Components.Schemas.RunEvent
/// How a run being carried on is getting on: picked up, thinking, or writing with the text so far.
public typealias RunProgress = Components.Schemas.RunProgress

extension Agent: Identifiable {}
