import Foundation
import OpenAPIRuntime

/// The one entrance to the iris server: signing in and out, and every call the app makes to `/api`. Errors come out as
/// `AppError`; the generated types come out as they are, since they are the server's own contract.
public final class IrisBackend: Sendable {
    /// Where iris runs: the server openapi.json names.
    public static let production: URL = {
        do {
            return try Servers.Server1.url()
        } catch {
            preconditionFailure("openapi.json names its server with an absolute URL: \(error)")
        }
    }()

    private let vault: SignInVault
    let client: Client

    /// `origin` is the server's origin; `send` carries every request (`URLSession` by default).
    public init(
        origin: URL,
        store: some CredentialStore,
        send: @escaping Send = { request in try await URLSession.shared.data(for: request) },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        vault = SignInVault(origin: origin, store: store, send: send, now: now)
        client = Client(serverURL: origin, transport: AuthorizedTransport(vault: vault, send: send))
    }

    /// Whether the app holds a sign-in. The server may still refuse it; calls then throw `.signedOut`.
    public var isSignedIn: Bool {
        get async { await vault.isSignedIn }
    }

    /// Signs in through the sheet `authenticate` opens.
    public func signIn(authenticate: @escaping Authenticate) async throws(AppError) {
        try await vault.signIn(authenticate: authenticate)
    }

    /// Signs out here at once, then asks the server to end the sign-in too.
    public func signOut() async {
        await vault.signOut()
    }

    /// Runs one call of the generated client, with its errors as `AppError`.
    func call<Output>(_ operation: () async throws -> Output) async throws(AppError) -> Output {
        do {
            return try await operation()
        } catch {
            throw AppError(error)
        }
    }

    /// Reads one answer's body, with a body that does not decode as `AppError`.
    func decoded<Value>(_ body: () throws -> Value) throws(AppError) -> Value {
        do {
            return try body()
        } catch {
            throw AppError(error)
        }
    }

    /// The refusal in a `{ message }` answer.
    func refusal(_ body: () throws -> Components.Schemas._Error) throws(AppError) -> AppError {
        .refused(message: try decoded(body).message)
    }
}
