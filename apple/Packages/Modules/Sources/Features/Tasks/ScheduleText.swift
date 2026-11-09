import Backend
import Foundation

/// How the app writes when a task runs.
enum ScheduleText {
    /// 毎日 7:00 for a task that runs once a day, otherwise its cron expression as it is; followed by the time zone
    /// when it is not the device's, as in 毎日 7:00（America/New_York）.
    static func of(_ schedule: ScheduledTask.SchedulePayload, deviceTimeZone: TimeZone = .current) -> String {
        let when = DailyTime(cron: schedule.cron).map { "毎日 \($0.text)" } ?? schedule.cron
        return schedule.timeZone == deviceTimeZone.identifier ? when : "\(when)（\(schedule.timeZone)）"
    }
}
