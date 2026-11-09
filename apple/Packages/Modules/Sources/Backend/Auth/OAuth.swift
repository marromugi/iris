import Foundation

/// The exchanges with iris's authorization server: registering the app, the authorize URL the sign-in sheet opens, the
/// code it sends back, and getting and refreshing tokens. Only builds requests and reads answers; sending is the caller's.
enum OAuth {
    /// The private-use scheme the server sends the sign-in back to (RFC 8252), named after the bundle ID.
    static let callbackScheme = "dev.marromugi.iris"
    /// The server accepts only this redirect for the app; change both together.
    static let redirectURI = "dev.marromugi.iris:/oauth"

    /// The resource the app's tokens are for: the server's `/api`.
    static func resource(origin: URL) -> String {
        origin.appending(path: "api").absoluteString
    }

    static func registration(origin: URL) -> URLRequest {
        var request = URLRequest(url: origin.appending(path: "register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "client_name": "iris",
            "redirect_uris": [redirectURI],
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            preconditionFailure("A dictionary of strings and string arrays always serializes")
        }
        request.httpBody = data
        return request
    }

    static func clientID(fromRegistration data: Data) throws(AppError) -> String {
        struct Registered: Decodable {
            let clientID: String
            enum CodingKeys: String, CodingKey { case clientID = "client_id" }
        }
        guard let registered = try? JSONDecoder().decode(Registered.self, from: data) else { throw .unexpected }
        return registered.clientID
    }

    static func authorizeURL(origin: URL, clientID: String, pkce: PKCE, state: String) -> URL {
        guard var components = URLComponents(url: origin.appending(path: "authorize"), resolvingAgainstBaseURL: false) else {
            preconditionFailure("\(origin) is an absolute URL, so its /authorize parses")
        }
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "resource", value: resource(origin: origin)),
        ]
        guard let url = components.url else { preconditionFailure("Query items made of strings always form a URL") }
        return url
    }

    /// The authorization code in the URL the sign-in sheet came back with. The state must be the one sent, so a
    /// sign-in this app did not start is refused.
    static func code(fromCallback callback: URL, expectedState: String) throws(AppError) -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
        if let error = value("error") { throw error == "access_denied" ? .cancelled : .unexpected }
        guard value("state") == expectedState, let code = value("code"), !code.isEmpty else { throw .unexpected }
        return code
    }

    static func codeExchange(origin: URL, clientID: String, code: String, verifier: String) -> URLRequest {
        tokenRequest(
            origin: origin,
            form: [
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirectURI,
                "client_id": clientID,
                "code_verifier": verifier,
                "resource": resource(origin: origin),
            ])
    }

    static func refresh(origin: URL, clientID: String, refreshToken: String) -> URLRequest {
        tokenRequest(
            origin: origin,
            form: [
                "grant_type": "refresh_token",
                "refresh_token": refreshToken,
                "client_id": clientID,
                "resource": resource(origin: origin),
            ])
    }

    /// Ends the grant behind a refresh token (RFC 7009), so the tokens stop working on the server too. The server takes
    /// revocations at its token endpoint.
    static func revocation(origin: URL, clientID: String, refreshToken: String) -> URLRequest {
        tokenRequest(
            origin: origin,
            form: [
                "token": refreshToken,
                "token_type_hint": "refresh_token",
                "client_id": clientID,
            ])
    }

    /// The tokens in a token endpoint answer, with when the access token stops working.
    static func tokens(fromResponse data: Data, now: Date) throws(AppError) -> Tokens {
        struct Answer: Decodable {
            let accessToken: String
            let refreshToken: String
            let expiresIn: Double
            enum CodingKeys: String, CodingKey {
                case accessToken = "access_token"
                case refreshToken = "refresh_token"
                case expiresIn = "expires_in"
            }
        }
        guard let answer = try? JSONDecoder().decode(Answer.self, from: data) else { throw .unexpected }
        return Tokens(
            accessToken: answer.accessToken,
            refreshToken: answer.refreshToken,
            expiresAt: now.addingTimeInterval(answer.expiresIn)
        )
    }

    private static func tokenRequest(origin: URL, form: [String: String]) -> URLRequest {
        var request = URLRequest(url: origin.appending(path: "token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(formEncoded(form).utf8)
        return request
    }

    private static func formEncoded(_ form: [String: String]) -> String {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        func escape(_ text: String) -> String {
            text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
        }
        return form.sorted { $0.key < $1.key }.map { "\(escape($0.key))=\(escape($0.value))" }.joined(separator: "&")
    }
}
