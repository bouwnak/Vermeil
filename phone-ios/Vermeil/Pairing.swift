import Foundation
import Security

/// The link from the computer: the normal phone link (https://…/#key=…) or the app link (vermeil://pair?u=…&k=…).
enum Pairing {
    static func parse(_ text: String) -> (url: URL, key: String)? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: trimmed) else { return nil }
        if parts.scheme == "vermeil" {
            let items = parts.queryItems ?? []
            guard let address = items.first(where: { $0.name == "u" })?.value,
                  let key = items.first(where: { $0.name == "k" })?.value, !key.isEmpty,
                  let url = siteURL(address) else { return nil }
            return (url, key)
        }
        guard let fragment = parts.fragment, fragment.hasPrefix("key="),
              let key = String(fragment.dropFirst(4)).removingPercentEncoding, !key.isEmpty,
              let url = siteURL(trimmed) else { return nil }
        return (url, key)
    }

    /// only the scheme, host and port - the app adds /api/... itself
    static func siteURL(_ text: String) -> URL? {
        guard let parts = URLComponents(string: text), let scheme = parts.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = parts.host, !host.isEmpty else { return nil }
        var site = URLComponents()
        site.scheme = scheme
        site.host = host
        site.port = parts.port
        return site.url
    }
}

/// The key is a secret, so it lives in the Keychain (readable while the phone is locked, after the first unlock).
enum Keychain {
    private static let service = "vermeil.phone"

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func set(_ value: String?, for account: String) {
        SecItemDelete(query(account) as CFDictionary)
        guard let data = value?.data(using: .utf8) else { return }
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ account: String) -> String? {
        var ask = query(account)
        ask[kSecReturnData as String] = true
        ask[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(ask as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
