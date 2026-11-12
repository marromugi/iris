import Backend
import SwiftUI

#if os(iOS)
    import UIKit
#else
    import AppKit
#endif

/// The user's mail: making an address to forward mail to, where forwarding stands, and changing or stopping it.
struct MailScreen: View {
    @Environment(MailSetupModel.self) private var mail

    var body: some View {
        LoadableContent(
            state: mail.setup,
            onRetry: { Task { await mail.load() } }
        ) { setup in
            MailSetupList(
                setup: setup,
                isChanging: mail.isChanging,
                problem: mail.problem,
                onMakeAddress: { mail.makeAddress() },
                onStop: { mail.stop() },
                onShowConfirmation: { mail.offerConfirmation() }
            )
        }
        .navigationTitle("メール")
        .task { await mail.load() }
    }
}

/// The mail setup as a list: what to do next, and the changes the user can make.
struct MailSetupList: View {
    let setup: MailSetup
    let isChanging: Bool
    let problem: AppError?
    let onMakeAddress: () -> Void
    let onStop: () -> Void
    let onShowConfirmation: () -> Void

    @State private var asking: Asking?

    /// Which change the user is asked to be sure of.
    enum Asking: Identifiable {
        case remake
        case stop
        var id: Self { self }
    }

    var body: some View {
        List {
            if let address = setup.address {
                AddressSection(address: address)
                StatusSection(status: MailStatus(setup), onShowConfirmation: onShowConfirmation)
                Section {
                    Link(destination: Gmail.forwardingSettings(account: setup.forwardingAccount)) {
                        Label("Gmail の転送の設定を開く", systemImage: "arrow.up.forward.app")
                    }
                } footer: {
                    Text("Gmail の設定 → メール転送と POP/IMAP で「転送先アドレスを追加」に上のアドレスを入れます。確認メールが届くと、ここに次の手順が出ます。")
                }
                Section {
                    Button("アドレスを作り直す") { asking = .remake }
                    Button("メールの受け取りをやめる", role: .destructive) { asking = .stop }
                }
                .disabled(isChanging)
            } else {
                Section {
                    Button("アドレスを作る", action: onMakeAddress)
                        .disabled(isChanging)
                } footer: {
                    Text("iris 用のメールアドレスを作り、Gmail などからメールを転送すると、エージェントが読めるようになります。メールは届いてから 7 日で消えます。")
                }
            }
            if let message = problem?.message {
                Section {
                    Text(message)
                        .foregroundStyle(.red)
                }
            }
        }
        .confirmationDialog(
            asking == .stop ? "メールの受け取りをやめますか？" : "アドレスを作り直しますか？",
            isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
            titleVisibility: .visible,
            presenting: asking
        ) { asking in
            switch asking {
            case .remake:
                Button("作り直す", action: onMakeAddress)
            case .stop:
                Button("やめる", role: .destructive, action: onStop)
            }
        } message: { asking in
            switch asking {
            case .remake:
                Text("今のアドレスにはメールが届かなくなります。Gmail の転送先も新しいアドレスに替えてください。")
            case .stop:
                Text("アドレスにはメールが届かなくなり、エージェントが読めるように置いていたメールも消えます。")
            }
        }
    }
}

/// The address, to copy into Gmail.
private struct AddressSection: View {
    let address: String

    var body: some View {
        Section("転送先のアドレス") {
            Text(address)
                .font(.callout.monospaced())
                .textSelection(.enabled)
            Button("コピー", systemImage: "doc.on.doc") { copy(address) }
        }
    }
}

/// Where forwarding stands, and the way on when Gmail's confirmation is waiting.
private struct StatusSection: View {
    let status: MailStatus
    let onShowConfirmation: () -> Void

    var body: some View {
        Section("状態") {
            switch status {
            case .noAddress, .waiting:
                Label("Gmail からの確認メールか、最初のメールを待っています", systemImage: "hourglass")
            case .confirmationArrived:
                Label("Gmail から確認メールが届きました", systemImage: "envelope.badge")
                Button("確認を進める", action: onShowConfirmation)
            case .receiving(let lastMailAt):
                Label("メールを受け取っています", systemImage: "checkmark.circle")
                LabeledContent("最後に届いた") {
                    AgoText(date: lastMailAt)
                }
            }
        }
    }
}

private func copy(_ text: String) {
    #if os(iOS)
        UIPasteboard.general.string = text
    #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    #endif
}

#if DEBUG
    #Preview("アドレスなし") {
        NavigationStack {
            MailSetupList(
                setup: MailSetup(), isChanging: false, problem: nil,
                onMakeAddress: {}, onStop: {}, onShowConfirmation: {})
        }
    }

    #Preview("確認を待っている") {
        NavigationStack {
            MailSetupList(
                setup: FakeMailBackend.waitingSetup, isChanging: false, problem: nil,
                onMakeAddress: {}, onStop: {}, onShowConfirmation: {})
        }
    }

    #Preview("確認メールが届いた") {
        NavigationStack {
            MailSetupList(
                setup: FakeMailBackend.confirmationSetup, isChanging: false, problem: nil,
                onMakeAddress: {}, onStop: {}, onShowConfirmation: {})
        }
    }

    #Preview("受け取り中") {
        NavigationStack {
            MailSetupList(
                setup: FakeMailBackend.receivingSetup, isChanging: false, problem: .offline,
                onMakeAddress: {}, onStop: {}, onShowConfirmation: {})
        }
    }
#endif
