import Foundation

/// The places in Gmail the mail setup sends the user to.
enum Gmail {
    /// Gmail's settings for forwarding, in the browser: those of `account` when it is known, so a user signed in to
    /// several Google accounts lands in the one that forwards; otherwise the browser's first account.
    static func forwardingSettings(account: String?) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "mail.google.com"
        components.path = "/mail/"
        if let account {
            // A `+` left as is would be read as a space.
            var allowed = CharacterSet.urlQueryAllowed
            allowed.remove(charactersIn: "+&=")
            components.percentEncodedQuery = "authuser=" + (account.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
        }
        components.fragment = "settings/fwdandpop"
        guard let url = components.url else {
            preconditionFailure("The address of Gmail's forwarding settings doesn't parse.")
        }
        return url
    }
}
