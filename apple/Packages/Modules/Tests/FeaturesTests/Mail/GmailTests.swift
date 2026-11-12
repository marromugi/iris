import Foundation
import Testing

@testable import Features

struct GmailTests {
    @Test func forwardingSettingsOpenTheAccountThatAsked() {
        #expect(
            Gmail.forwardingSettings(account: "taro.y+x@example.co.jp").absoluteString
                == "https://mail.google.com/mail/?authuser=taro.y%2Bx@example.co.jp#settings/fwdandpop")
    }

    @Test func forwardingSettingsWithoutAnAccountOpenTheFirstOne() {
        #expect(
            Gmail.forwardingSettings(account: nil).absoluteString == "https://mail.google.com/mail/#settings/fwdandpop")
    }
}
