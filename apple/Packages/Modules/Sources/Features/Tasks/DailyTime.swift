import Foundation

/// A time of day a task runs every day, sent as the cron `m h * * *`.
struct DailyTime: Equatable {
    /// 0 to 23.
    let hour: Int
    /// 0 to 59.
    let minute: Int

    /// The hour and minute of `date` on `calendar`, in its time zone.
    init(of date: Date, on calendar: Calendar) {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else {
            preconditionFailure("Every date has an hour and a minute on a Gregorian calendar")
        }
        self.init(hour: hour, minute: minute)
    }

    /// The time a cron expression runs at when it runs once every day at a fixed time; nil for any other expression.
    init?(cron: String) {
        let fields = cron.split(separator: " ")
        guard fields.count == 5, fields[2...].allSatisfy({ $0 == "*" }),
            let minute = Int(fields[0]), (0...59).contains(minute),
            let hour = Int(fields[1]), (0...23).contains(hour)
        else { return nil }
        self.init(hour: hour, minute: minute)
    }

    init(hour: Int, minute: Int) {
        precondition((0...23).contains(hour) && (0...59).contains(minute), "\(hour):\(minute) is not a time of day")
        self.hour = hour
        self.minute = minute
    }

    var cron: String { "\(minute) \(hour) * * *" }

    /// Such as 7:05.
    var text: String { "\(hour):" + (minute < 10 ? "0\(minute)" : "\(minute)") }

    /// Today at this time on `calendar`, for a time picker.
    func date(on calendar: Calendar, now: Date) -> Date {
        guard let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: now) else {
            preconditionFailure("Under the default next-time policy, \(text) finds a date on every day")
        }
        return date
    }
}
