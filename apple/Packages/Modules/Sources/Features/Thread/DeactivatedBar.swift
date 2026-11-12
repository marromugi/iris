import SwiftUI

/// What takes the message field's place while the thread's agent is deactivated: why nothing can be sent, and the
/// way to activate it again.
struct DeactivatedBar: View {
    let isSwitching: Bool
    let onActivate: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text("このエージェントは停止中です。返事をせず、タスクも動きません。")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("再開", systemImage: "play.fill", action: onActivate)
                .buttonStyle(.borderedProminent)
                .disabled(isSwitching)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(.bar)
    }
}

#if DEBUG
    #Preview("停止中") {
        VStack {
            Spacer()
            DeactivatedBar(isSwitching: false) {}
        }
    }
#endif
