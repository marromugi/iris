import Foundation
import Testing

@testable import Backend

struct SignInVaultTests {
    let server = FakeServer()

    @Test func aRefusalThatArrivesAfterTheRefreshUsesTheRefreshedToken() async throws {
        let vault = SignInVault(origin: server.origin, store: InMemoryCredentialStore(), send: server.send, now: { Date() })
        try await vault.signIn { url, _ in try await server.signInSheet(url: url) }

        let refreshed = try await vault.refreshedAccessToken(replacing: "access-1")
        let late = try await vault.refreshedAccessToken(replacing: "access-1")

        #expect(refreshed == "access-2")
        #expect(late == "access-2")
    }
}
