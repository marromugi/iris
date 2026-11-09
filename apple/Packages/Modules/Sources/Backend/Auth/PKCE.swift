import CryptoKit
import Foundation

/// A PKCE pair (RFC 7636, S256): the verifier stays in the app, the challenge goes to the authorize page.
struct PKCE: Sendable, Equatable {
    let verifier: String
    let challenge: String

    init(verifier: String) {
        self.verifier = verifier
        self.challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded()
    }

    /// A fresh pair with a 256-bit random verifier.
    static func make() -> PKCE {
        PKCE(verifier: randomToken())
    }
}

/// 32 random bytes, base64url without padding.
func randomToken() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return Data(bytes).base64URLEncoded()
}

extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
