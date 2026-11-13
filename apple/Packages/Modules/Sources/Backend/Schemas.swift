// The server's types as the app reads them, under names that say what they are in the app. They are the generated
// ones, since openapi.json is the server's contract.

/// One of the user's agents: what it is called, when its latest run started (nil until it first runs), and whether it
/// is active or deactivated.
public typealias Agent = Components.Schemas.Agent
/// One of the user's threads as the home lists it: an agent's one-to-one thread, or a group of agents. Not `Thread`,
/// which is Foundation's own.
public typealias ChatThread = Components.Schemas.Thread
/// What making a group sends: its name and its members.
public typealias NewGroup = Components.Schemas.NewGroup
/// What the user said in a thread.
public typealias Post = Components.Schemas.Post
/// A consult a run's agent asked in: the tool call that asked, and the consult's thread.
public typealias Consult = Components.Schemas.Consult
/// A post or a run of a thread.
public typealias ThreadEntry = Components.Schemas.ThreadEntry
/// A post sent, with the runs that reply to it as they start.
public typealias SentPost = Components.Schemas.SentPost
/// How an agent's orb is drawn: one of the app's palettes, taken modulo how many there are, and the seed of its grain.
public typealias AgentLook = Components.Schemas.Look
/// What adding an agent sends: its name.
public typealias NewAgent = Components.Schemas.NewAgent
/// A task an agent runs on its schedule, with when it runs next. Not `Task`, which is Swift's own.
public typealias ScheduledTask = Components.Schemas.Task
/// What adding a task sends: the prompt each run starts with, and when it runs.
public typealias NewTask = Components.Schemas.NewTask
/// What sending a message to an agent sends: the text the run it starts begins with, and the images put up for it.
public typealias NewMessage = Components.Schemas.NewMessage
/// An image put up to send with a post: its ID, media type, and size in bytes.
public typealias Attachment = Components.Schemas.Attachment
/// The signed-in user: their name, and whether their posts may carry images.
public typealias Me = Components.Schemas.Me
/// One run of an agent, started by a task or by a message sent to it: when it started and ended, how its attempts
/// went, and its conversation.
public typealias Run = Components.Schemas.Run
/// One message of a run's conversation: the user's prompt, the assistant's answer, or a tool's result.
public typealias RunMessage = Components.Schemas.Message
/// What an agent's events socket sends: a run as it is now, or how the run being carried on is getting on.
public typealias RunEvent = Components.Schemas.RunEvent
/// How a run being carried on is getting on: picked up, thinking, or writing with the text so far.
public typealias RunProgress = Components.Schemas.RunProgress
/// Where the user's mail setup stands: their address (nil until one is made), Gmail's forwarding confirmation waiting
/// for them, the Gmail account that asked to forward, and when mail last arrived.
public typealias MailSetup = Components.Schemas.MailSetup
/// Gmail's forwarding confirmation: the link that confirms the address to Gmail, and the code that does the same.
public typealias MailConfirmation = Components.Schemas.MailSetup.ConfirmationPayload
/// What the user's events socket sends: that their mail setup changed.
public typealias UserEvent = Components.Schemas.UserEvent

extension Agent: Identifiable {}
extension ChatThread: Identifiable {}
extension Attachment: Identifiable {
    /// The most bytes an image may have; the server takes no larger one.
    public static let largestBytes = 5 * 1024 * 1024
}
