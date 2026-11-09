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

    /// How long before `now` a moment was, such as 14 分前 or 昨日; 1 分以内 under a minute, and for a moment after
    /// `now`.
    static func ago(_ date: Date, from now: Date) -> String {
        var style = Date.AnchoredRelativeFormatStyle(
            anchor: date, presentation: .named, unitsStyle: .wide, locale: japanese)
        // No seconds: the screens write it again once a minute.
        style.allowedFields = [.year, .month, .week, .day, .hour, .minute]
        // A moment after `now` is one that just happened: the screens pass the start of the current minute, and the
        // device's clock may be behind the server's.
        return style.format(max(now, date))
    }

    private static let japanese = Locale(identifier: "ja_JP")
}
