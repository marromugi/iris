import Foundation

/// How the app writes a moment: in Japanese, in the device's time zone unless told otherwise.
enum DateText {
    /// A moment such as 11月10日(火) 7:00.
    static func moment(_ date: Date, in timeZone: TimeZone = .current) -> String {
        date.formatted(
            Date.FormatStyle(locale: japanese, timeZone: timeZone)
                .month(.abbreviated).day().weekday(.abbreviated)
                .hour(.defaultDigits(amPM: .omitted)).minute(.twoDigits)
        )
    }

    private static let japanese = Locale(identifier: "ja_JP")
}
