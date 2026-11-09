import Foundation
import Testing

@testable import Backend

struct OAuthTests {
    let origin = URL(string: "https://iris.test")!

    @Test func pkceChallengeIsTheS256OfTheVerifier() {
        // The example in RFC 7636, appendix B.
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")

        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func authorizeURLAsksForTheAPIResourceWithPKCEAndState() throws {
        let pkce = PKCE(verifier: "verifier")

        let url = OAuth.authorizeURL(origin: origin, clientID: "client", pkce: pkce, state: "state-1")

        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.path == "/authorize")
        #expect(
            Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") }) == [
                "response_type": "code",
                "client_id": "client",
                "redirect_uri": "dev.marromugi.iris:/oauth",
                "code_challenge": pkce.challenge,
                "code_challenge_method": "S256",
                "state": "state-1",
                "resource": "https://iris.test/api",
            ])
    }

    @Test func callbackGivesTheCodeOnlyForTheStateThatWasSent() throws {
        let callback = try #require(URL(string: "dev.marromugi.iris:/oauth?code=abc&state=state-1&iss=https%3A%2F%2Firis.test"))

        #expect(try OAuth.code(fromCallback: callback, expectedState: "state-1") == "abc")
        #expect(throws: AppError.unexpected) { try OAuth.code(fromCallback: callback, expectedState: "state-2") }
    }

    @Test(arguments: [
        ("dev.marromugi.iris:/oauth?error=access_denied&state=s", AppError.cancelled),
        ("dev.marromugi.iris:/oauth?error=server_error&state=s", AppError.unexpected),
        ("dev.marromugi.iris:/oauth?state=s", AppError.unexpected),
    ])
    func callbackWithoutACodeIsRefused(callback: String, error: AppError) throws {
        let url = try #require(URL(string: callback))

        #expect(throws: error) { try OAuth.code(fromCallback: url, expectedState: "s") }
    }
}
