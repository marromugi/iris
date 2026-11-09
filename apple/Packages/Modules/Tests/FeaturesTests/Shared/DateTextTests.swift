import Foundation
import Testing

@testable import Features

struct DateTextTests {
    @Test func writesAMomentInJapaneseInTheGivenTimeZone() {
        let moment = Samples.moment("2026-11-10T22:05:00Z")

        #expect(DateText.moment(moment, in: TimeZone(identifier: "Asia/Tokyo")!) == "11月11日(水) 7:05")
    }

    @Test(arguments: [
        (secondsBefore: 20.0, text: "1 分以内"),
        (secondsBefore: 14 * 60.0, text: "14 分前"),
        (secondsBefore: 3 * 3600.0, text: "3 時間前"),
    ])
    func writesHowLongAgoInMinutesAtTheFinest(secondsBefore: TimeInterval, text: String) {
        let now = Samples.moment("2026-11-10T12:00:00Z")

        #expect(DateText.ago(now.addingTimeInterval(-secondsBefore), from: now) == text)
    }
}
