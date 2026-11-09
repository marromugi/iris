import Foundation
import OSLog
import Security

/// The sign-in in the Keychain, readable after the first unlock, on this device only.
public struct KeychainCredentialStore: CredentialStore {
    private static let service = "dev.marromugi.iris"
    private static let account = "credentials"
    private static let log = Logger(subsystem: "dev.marromugi.iris", category: "keychain")

    private static var match: [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    }

    public init() {}

    public func load() -> Credentials? {
        var query = Self.match
        query[kSecReturnData] = true
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        // Anything else unreadable means signing in again, which is all the caller could do about it.
        guard status == errSecSuccess, let data = item as? Data,
            let credentials = try? JSONDecoder().decode(Credentials.self, from: data)
        else {
            Self.log.error("Could not read the sign-in: \(status)")
            return nil
        }
        return credentials
    }

    public func save(_ credentials: Credentials?) {
        SecItemDelete(Self.match as CFDictionary)
        guard let credentials else { return }
        guard let data = try? JSONEncoder().encode(credentials) else {
            preconditionFailure("Credentials hold only strings and a date, which always encode")
        }
        var item = Self.match
        item[kSecValueData] = data
        item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        // Not saved means signing in again on the next launch, which is all the caller could do about it.
        if status != errSecSuccess { Self.log.error("Could not save the sign-in: \(status)") }
    }
}
