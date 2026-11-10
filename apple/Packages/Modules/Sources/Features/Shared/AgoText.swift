import SwiftUI

/// How long ago a moment was, such as 14 分前, kept current as the minutes pass.
struct AgoText: View {
    let date: Date

    var body: some View {
        TimelineView(.everyMinute) { context in
            Text(DateText.ago(date, from: context.date))
        }
    }
}

#Preview {
    AgoText(date: .now.addingTimeInterval(-14 * 60))
}
