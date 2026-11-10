import SwiftUI

/// Where the user writes a message to the agent and sends it.
struct MessageBar: View {
    @Binding var text: String
    let canSend: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("メッセージ", text: $text, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.fill.tertiary, in: .rect(cornerRadius: 20))
            Button("送信", systemImage: "arrow.up.circle.fill", action: onSend)
                .labelStyle(.iconOnly)
                .font(.title)
                .disabled(!canSend)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }
}

#if DEBUG
    #Preview("空") {
        @Previewable @State var text = ""
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: false) {}
        }
    }

    #Preview("書きかけ") {
        @Previewable @State var text = "さっきの 2 件目をもう少し詳しく教えて。"
        VStack {
            Spacer()
            MessageBar(text: $text, canSend: true) {}
        }
    }
#endif
