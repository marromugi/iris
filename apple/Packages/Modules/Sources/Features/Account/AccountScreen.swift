import SwiftUI

/// The user's account: their mail setup, and signing out.
struct AccountScreen: View {
    let onSignOut: () -> Void
    @Environment(MailSetupModel.self) private var mail

    var body: some View {
        List {
            Section {
                NavigationLink {
                    MailScreen()
                } label: {
                    LabeledContent {
                        Text(mail.setup.value.map { MailStatus($0).summary } ?? "")
                    } label: {
                        Label("メール", systemImage: "envelope")
                    }
                }
            } footer: {
                Text("転送したメールをエージェントが読めます。")
            }
            Section {
                Button(
                    "サインアウト", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive,
                    action: onSignOut)
            }
        }
        .navigationTitle("アカウント")
    }
}

#if DEBUG
    #Preview {
        NavigationStack {
            AccountScreen {}
        }
        .environment(
            MailSetupModel(backend: FakeMailBackend(FakeMailBackend.Answers(setup: .success(FakeMailBackend.receivingSetup)))))
    }
#endif
