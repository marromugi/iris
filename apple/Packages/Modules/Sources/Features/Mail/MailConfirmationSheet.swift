import Backend
import SwiftUI

/// The steps Gmail's forwarding confirmation asks of the user: open its link, then turn forwarding on in Gmail.
struct MailConfirmationSheet: View {
    let offer: MailSetupModel.Offer
    /// The address mail is forwarded to, for the last step to name.
    let address: String?
    let onOpened: () -> Void
    let onClose: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                switch offer {
                case .confirm(let confirmation):
                    Step(
                        systemImage: "envelope.badge",
                        title: "Gmail の転送を確認する",
                        text: "Gmail から確認メールが届きました。リンクを開くと、このアドレスへの転送を Gmail が受け付けます。"
                    )
                    if let code = confirmation.code {
                        LabeledContent("確認コード", value: code)
                            .textSelection(.enabled)
                        Text("リンクの代わりに、Gmail の転送の設定でこのコードを入れても確認できます。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    if let url = URL(string: confirmation.url) {
                        Button("リンクを開く") {
                            openURL(url)
                            onOpened()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                case .turnOnForwarding(let account):
                    Step(
                        systemImage: "arrow.triangle.turn.up.right.circle",
                        title: "Gmail で転送を有効にする",
                        text: "最後に Gmail の設定 → メール転送と POP/IMAP で「受信メールを \(address ?? "このアドレス") に転送する」を選び、「変更を保存」を押してください。"
                    )
                    Link("Gmail の転送の設定を開く", destination: Gmail.forwardingSettings(account: account))
                        .buttonStyle(.borderedProminent)
                }
            }
            .padding()
            .frame(maxHeight: .infinity, alignment: .top)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isLastStep ? "完了" : "あとで", action: onClose)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var isLastStep: Bool {
        if case .turnOnForwarding = offer { return true }
        return false
    }
}

/// One step: a picture, what it is, and what to do.
private struct Step: View {
    let systemImage: String
    let title: String
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(.tint)
            Text(title)
                .font(.title2.bold())
            Text(text)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
    }
}

#if DEBUG
    #Preview("確認") {
        Color.clear.sheet(isPresented: .constant(true)) {
            MailConfirmationSheet(
                offer: .confirm(FakeMailBackend.confirmation), address: FakeMailBackend.address,
                onOpened: {}, onClose: {})
        }
    }

    #Preview("転送を有効にする") {
        Color.clear.sheet(isPresented: .constant(true)) {
            MailConfirmationSheet(
                offer: .turnOnForwarding(account: FakeMailBackend.confirmation.account), address: FakeMailBackend.address,
                onOpened: {}, onClose: {})
        }
    }
#endif
