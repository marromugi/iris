import AuthenticationServices
import Backend
import SwiftUI

/// The whole app: the sign-in until the user is signed in, then their agents.
public struct IrisRoot: View {
    // Both kept from the first time the view is made, so the session and the screens share one sign-in.
    @State private var session: Session
    @State private var agents: any AgentDirectory
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    /// The app against the server at `origin`, keeping the sign-in in the Keychain.
    public init(origin: URL) {
        let backend = IrisBackend(origin: origin, store: KeychainCredentialStore())
        self.init(session: Session(backend: backend), agents: backend)
    }

    init(session: Session, agents: any AgentDirectory) {
        _session = State(initialValue: session)
        _agents = State(initialValue: agents)
    }

    public var body: some View {
        content
            .environment(session)
            .task { await session.start() }
            .task(id: session.state == .signedIn) {
                guard session.state == .signedIn else { return }
                await session.keepTimeZoneSent(
                    current: { TimeZone.autoupdatingCurrent.identifier },
                    changes: NotificationCenter.default.notifications(named: .NSSystemTimeZoneDidChange).map { _ in }
                )
            }
    }

    @ViewBuilder private var content: some View {
        switch session.state {
        case .checking:
            ProgressView()
        case .signedOut, .signingIn:
            SignInView(isSigningIn: session.state == .signingIn, problem: session.problem?.message) {
                session.signIn(authenticate: authenticate)
            }
        case .signedIn:
            NavigationStack {
                HomeScreen(directory: agents) {
                    Task { await session.signOut() }
                }
            }
        }
    }

    /// Opens the sign-in sheet on the server's page; the page signs in with a passkey and sends the app back.
    private var authenticate: Authenticate {
        let session = webAuthenticationSession
        return { @MainActor url, callbackScheme in
            try await session.authenticate(
                using: url,
                callback: .customScheme(callbackScheme),
                preferredBrowserSession: .shared,
                additionalHeaderFields: [:]
            )
        }
    }
}
