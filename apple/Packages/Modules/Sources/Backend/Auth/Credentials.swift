import Foundation

/// An access token for `/api`, the refresh token that renews it, and when the access token stops working.
public struct Tokens: Codable, Equatable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date

    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }
}

/// A sign-in kept between launches: the server it is for, the client ID the app registered as for it, and its tokens.
public struct Credentials: Codable, Equatable, Sendable {
    public var origin: String
    public var clientID: String
    public var tokens: Tokens

    public init(origin: String, clientID: String, tokens: Tokens) {
        self.origin = origin
        self.clientID = clientID
        self.tokens = tokens
    }
}

/// Where the sign-in is kept between launches. Nothing kept means signed out.
public protocol CredentialStore: Sendable {
    func load() -> Credentials?
    func save(_ credentials: Credentials?)
}
