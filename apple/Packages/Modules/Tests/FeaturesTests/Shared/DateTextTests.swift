import Foundation
import Testing

@testable import Features

struct DateTextTests {
    @Test func writesAMomentInJapaneseInTheGivenTimeZone() {
        let moment = Samples.moment("2026-11-10T22:05:00Z")

        #expect(DateText.moment(moment, in: TimeZone(identifier: "Asia/Tokyo")!) == "11月11日(水) 7:05")
    }
}
