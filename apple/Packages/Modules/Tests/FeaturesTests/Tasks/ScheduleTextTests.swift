import Backend
import Foundation
import Testing

@testable import Features

struct ScheduleTextTests {
    let tokyo = TimeZone(identifier: "Asia/Tokyo")!

    @Test(arguments: [
        ("5 7 * * *", "Asia/Tokyo", "毎日 7:05"),
        ("30 21 * * *", "America/New_York", "毎日 21:30（America/New_York）"),
        ("0 12 * * 1-5", "Asia/Tokyo", "0 12 * * 1-5"),
        ("*/15 * * * *", "Europe/London", "*/15 * * * *（Europe/London）"),
    ])
    func saysWhenATaskRuns(cron: String, timeZone: String, text: String) {
        let schedule = ScheduledTask.SchedulePayload(cron: cron, timeZone: timeZone)

        #expect(ScheduleText.of(schedule, deviceTimeZone: tokyo) == text)
    }
}
