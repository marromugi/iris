import Backend
import SwiftUI

/// A screen's content once it is read; until then, that it is coming, or why it could not be read. When the server no
/// longer accepts the sign-in, it offers to sign in again through the session in the environment.
struct LoadableContent<Value, Content: View>: View {
    let state: Loadable<Value>
    let onRetry: () -> Void
    @ViewBuilder let content: (Value) -> Content

    @Environment(Session.self) private var session: Session?

    var body: some View {
        switch state {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded(let value):
            content(value)
        case .failed(.signedOut):
            LoadFailedView(message: AppError.signedOut.message, action: "サインインし直す") {
                Task { await session?.signOut() }
            }
        case .failed(let error):
            LoadFailedView(message: error.message, action: "もう一度", onAction: onRetry)
        }
    }
}

/// Why something could not be read, and the one thing that may help.
struct LoadFailedView: View {
    let message: String?
    let action: String
    let onAction: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("読み込めません", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message ?? "")
        } actions: {
            Button(action, action: onAction)
        }
    }
}

#Preview("Failed") {
    LoadableContent(state: Loadable<String>.failed(.offline), onRetry: {}, content: { Text($0) })
}

#Preview("Signed out") {
    LoadableContent(state: Loadable<String>.failed(.signedOut), onRetry: {}, content: { Text($0) })
}

#Preview("Loading") {
    LoadableContent(state: Loadable<String>.loading, onRetry: {}, content: { Text($0) })
}
