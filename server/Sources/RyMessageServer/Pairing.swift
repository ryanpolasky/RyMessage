import Foundation

enum Pairing {
    struct Payload: Codable {
        var u: String
        var t: String
    }

    static func code(url: String, token: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try! encoder.encode(Payload(u: url, t: token))
        return "RYM1." + data.base64URLEncoded()
    }

    static func advertisedURL(config: ServerConfig) -> String {
        if let url = config.advertisedURL, !url.isEmpty {
            return url.hasSuffix("/") ? String(url.dropLast()) : url
        }
        let host = config.advertisedHost ?? lanAddresses().first ?? "localhost"
        return "http://\(host):\(config.port)"
    }

    static func printInstructions(config: ServerConfig) {
        let url = advertisedURL(config: config)
        let code = code(url: url, token: config.token)
        print("""

        ========================================================
          RyMessage Server
          Listening at \(url)

          Pairing code (paste into the RyMessage app on Windows):

          \(code)

          Wrong address? Set "advertisedHost" or "advertisedURL"
          in \(ConfigStore.file.path) and restart.
        ========================================================

        """)
    }

    private static func lanAddresses() -> [String] {
        var addresses: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return [] }
        defer { freeifaddrs(ifaddr) }
        var pointer: UnsafeMutablePointer<ifaddrs>? = first
        while let current = pointer {
            defer { pointer = current.pointee.ifa_next }
            guard let sa = current.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else {
                continue
            }
            let flags = Int32(current.pointee.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                sa,
                socklen_t(sa.pointee.sa_len),
                &host,
                socklen_t(host.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            if result == 0 {
                addresses.append(String(cString: host))
            }
        }
        return addresses
    }
}
