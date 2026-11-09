/// The failures screens react to differently. Screens pick the words; only `refused` carries the server's own.
public enum AppError: Error, Equatable, Sendable {
    /// Not signed in, or the sign-in ended (expired, revoked, or the token names no user): sign in again.
    case signedOut
    /// The server could not be reached.
    case offline
    /// The server did not do what was asked and said why, in the `message` of its `{ message }` answer: a request it
    /// does not accept, or a failure on its side.
    case refused(message: String)
    /// The server or the sign-in answered something the app does not expect.
    case unexpected
    /// Stopped by the person or the system; not a failure to show.
    case cancelled
}
