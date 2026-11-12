import Foundation

/// The places in Gmail the mail setup sends the user to.
enum Gmail {
    /// Gmail's settings for forwarding, in the browser.
    static let forwardingSettings: URL = {
        guard let url = URL(string: "https://mail.google.com/mail/u/0/#settings/fwdandpop") else {
            preconditionFailure("The address of Gmail's forwarding settings doesn't parse.")
        }
        return url
    }()
}
