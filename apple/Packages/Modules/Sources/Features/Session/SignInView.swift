import SwiftUI

/// The first screen: what iris is, and the one button that opens the passkey sign-in.
struct SignInView: View {
    let isSigningIn: Bool
    let problem: String?
    let onSignIn: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("iris")
                .font(.largeTitle.weight(.semibold))
            Text("あなたのエージェントに、決まった時刻に動くタスクを頼むアプリです。はじめての方は、受け取った招待からパスキーを作ります。")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let problem {
                Text(problem)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Button {
                onSignIn()
            } label: {
                Text(isSigningIn ? "サインイン中…" : "サインイン")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isSigningIn)
        }
        .padding(24)
    }
}

#Preview("サインイン前") {
    SignInView(isSigningIn: false, problem: nil) {}
}

#Preview("サインイン中") {
    SignInView(isSigningIn: true, problem: nil) {}
}

#Preview("つながらない") {
    SignInView(isSigningIn: false, problem: "サーバーにつながりません。電波を確かめて、もう一度試してください。") {}
}
