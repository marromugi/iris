import Foundation
import OSLog

/// Sends one HTTP request and gives back what came back: `URLSession.data(for:)` in the app, a fake in tests.
public typealias Send = @Sendable (URLRequest) async throws -> (Data, URLResponse)

/// Opens the sign-in sheet at a URL and gives back the URL it returned to, on the given callback scheme.
public typealias Authenticate = @Sendable (_ url: URL, _ callbackScheme: String) async throws -> URL

/// Holds the sign-in to one server: signs in through the sheet, keeps the tokens current, and ends the sign-in when the
/// server no longer accepts it or the user signs out. One refresh runs at a time; callers that need one meanwhile
/// wait for it.
actor SignInVault {
    // Refresh this long before the access token runs out, so a request does not leave with one about to expire.
    private static let refreshMargin: TimeInterval = 60
    private static let log = Logger(subsystem: "dev.marromugi.iris", category: "sign-in")

    private let origin: URL
    private let store: any CredentialStore
    private let send: Send
    private let now: @Sendable () -> Date
    // Read from the store on first use, so making the vault does no work. A sign-in kept for another server is not
    // this one's.
    private lazy var credentials: Credentials? = store.load().flatMap { $0.origin == origin.absoluteString ? $0 : nil }
    private var refreshing: Task<Result<Tokens, AppError>, Never>?

    init(origin: URL, store: any CredentialStore, send: @escaping Send, now: @escaping @Sendable () -> Date) {
        self.origin = origin
        self.store = store
        self.send = send
        self.now = now
    }

    var isSignedIn: Bool { credentials != nil }

    /// Registers the app afresh and signs in through the sheet. Registering each time means a registration the server
    /// has since dropped never stands in the way.
    func signIn(authenticate: Authenticate) async throws(AppError) {
        let (registered, registrationStatus) = try await perform(OAuth.registration(origin: origin))
        guard registrationStatus == 201 else { throw .unexpected }
        let clientID = try OAuth.clientID(fromRegistration: registered)
        let pkce = PKCE.make()
        let state = randomToken()
        let url = OAuth.authorizeURL(origin: origin, clientID: clientID, pkce: pkce, state: state)
        let callback: URL
        do {
            callback = try await authenticate(url, OAuth.callbackScheme)
        } catch {
            throw AppError(signInSheetError: error)
        }
        let code = try OAuth.code(fromCallback: callback, expectedState: state)
        let (data, status) = try await perform(
            OAuth.codeExchange(origin: origin, clientID: clientID, code: code, verifier: pkce.verifier))
        guard status == 200 else { throw .unexpected }
        let tokens = try OAuth.tokens(fromResponse: data, now: now())
        begin(Credentials(origin: origin.absoluteString, clientID: clientID, tokens: tokens))
    }

    /// Ends the sign-in here, then asks the server to end it too. A failed request is only logged: the app is signed
    /// out either way, and the server's grant runs out on its own.
    func signOut() async {
        guard let ended = credentials else { return }
        begin(nil)
        do throws(AppError) {
            let (_, status) = try await perform(
                OAuth.revocation(origin: origin, clientID: ended.clientID, refreshToken: ended.tokens.refreshToken))
            if status != 200 { Self.log.error("The server did not revoke the sign-in: \(status)") }
        } catch {
            Self.log.error("Could not ask the server to revoke the sign-in: \(String(describing: error))")
        }
    }

    /// An access token good for a while yet, refreshed first when it is about to run out.
    func accessToken() async throws(AppError) -> String {
        guard let tokens = credentials?.tokens else { throw .signedOut }
        if tokens.expiresAt.timeIntervalSince(now()) > Self.refreshMargin { return tokens.accessToken }
        return try await refreshedAccessToken(replacing: tokens.accessToken)
    }

    /// An access token to use instead of `stale`, which is about to run out or which the server refused: the current
    /// one if it has already been replaced, otherwise a refreshed one. The sign-in ends when refreshing is refused.
    func refreshedAccessToken(replacing stale: String) async throws(AppError) -> String {
        guard let held = credentials else { throw .signedOut }
        if held.tokens.accessToken != stale { return held.tokens.accessToken }
        let refresh = refreshing ?? startRefresh(of: held)
        refreshing = refresh
        let result = await refresh.value
        if refreshing == refresh { refreshing = nil }
        // While the refresh ran, another caller may have kept its tokens, or the user signed out or in again: the
        // sign-in held now answers.
        guard credentials == held else {
            guard let current = credentials else { throw .signedOut }
            return current.tokens.accessToken
        }
        switch result {
        case .success(let tokens):
            var renewed = held
            renewed.tokens = tokens
            keep(renewed)
            return tokens.accessToken
        case .failure(.signedOut):
            begin(nil)
            throw .signedOut
        case .failure(let error):
            throw error
        }
    }

    /// Ends the sign-in after the server refused `token` outright: a freshly refreshed one, or one that names no user.
    /// A sign-in that has already moved past `token` stays.
    func endSignIn(refusing token: String) {
        guard credentials?.tokens.accessToken == token else { return }
        begin(nil)
    }

    private func startRefresh(of held: Credentials) -> Task<Result<Tokens, AppError>, Never> {
        let request = OAuth.refresh(origin: origin, clientID: held.clientID, refreshToken: held.tokens.refreshToken)
        return Task { [send, now] in
            do throws(AppError) {
                let (data, status) = try await Self.perform(request, send: send)
                // The token endpoint answers 400 (invalid_grant) once the grant has ended, and 401 (invalid_client)
                // once the registration has.
                guard status == 200 else { return .failure(status == 400 || status == 401 ? .signedOut : .unexpected) }
                return .success(try OAuth.tokens(fromResponse: data, now: now()))
            } catch {
                return .failure(error)
            }
        }
    }

    /// Starts another sign-in, or none. A refresh still running belongs to the one before, so it is dropped.
    private func begin(_ credentials: Credentials?) {
        refreshing?.cancel()
        refreshing = nil
        keep(credentials)
    }

    private func keep(_ credentials: Credentials?) {
        self.credentials = credentials
        store.save(credentials)
    }

    private func perform(_ request: URLRequest) async throws(AppError) -> (Data, Int) {
        try await Self.perform(request, send: send)
    }

    private static func perform(_ request: URLRequest, send: Send) async throws(AppError) -> (Data, Int) {
        do {
            let (data, response) = try await send(request)
            guard let http = response as? HTTPURLResponse else { throw AppError.unexpected }
            return (data, http.statusCode)
        } catch {
            throw AppError(error)
        }
    }
}
