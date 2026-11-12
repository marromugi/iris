import AuthenticationServices
import Backend
import SwiftUI

/// The whole app: the sign-in until the user is signed in, then their agents.
public struct IrisRoot: View {
    // All kept from the first time the view is made, so the session and the screens share one sign-in.
    @State private var session: Session
    @State private var agents: any AgentDirectory
    @State private var mail: MailSetupModel
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Environment(\.scenePhase) private var scenePhase

    /// The app against the server at `origin`, keeping the sign-in in the Keychain.
    public init(origin: URL) {
        let backend = IrisBackend(origin: origin, store: KeychainCredentialStore())
        self.init(session: Session(backend: backend), agents: backend, mail: MailSetupModel(backend: backend))
    }

    init(session: Session, agents: any AgentDirectory, mail: MailSetupModel) {
        _session = State(initialValue: session)
        _agents = State(initialValue: agents)
        _mail = State(initialValue: mail)
    }

    public var body: some View {
        content
            .environment(session)
            .environment(mail)
            .task { await session.start() }
            // Starts again each time the app comes back, since a change while it was away may not be posted.
            .task(id: session.state == .signedIn && scenePhase == .active) {
                guard session.state == .signedIn, scenePhase == .active else { return }
                await session.keepTimeZoneSent(
                    current: { TimeZone.autoupdatingCurrent.identifier },
                    changes: NotificationCenter.default.notifications(named: .NSSystemTimeZoneDidChange).map { _ in }
                )
            }
            // Gmail's confirmation is offered over whatever is shown, so the mail setup is followed the whole time.
            .task(id: session.state == .signedIn && scenePhase == .active) {
                guard session.state == .signedIn, scenePhase == .active else { return }
                await mail.follow()
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
            .sheet(item: Binding(get: { mail.offer }, set: { if $0 == nil { mail.closeOffer() } })) { offer in
                MailConfirmationSheet(
                    offer: offer,
                    address: mail.setup.value?.address,
                    onOpened: { mail.openedConfirmation() },
                    onClose: { mail.closeOffer() }
                )
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
