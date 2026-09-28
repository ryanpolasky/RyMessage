import Foundation

struct ServerConfig: Codable {
    var token: String
    var port: Int
    var advertisedHost: String?
    var advertisedURL: String?
    var allowedOrigins: [String]?
}

enum ConfigStore {
    static var directory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".rymessage", isDirectory: true)
    }

    static var file: URL {
        directory.appendingPathComponent("config.json")
    }

    static func loadOrCreate() throws -> ServerConfig {
        let fm = FileManager.default
        if fm.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            return try JSONDecoder().decode(ServerConfig.self, from: data)
        }
        let config = ServerConfig(
            token: randomToken(),
            port: 8787,
            advertisedHost: nil,
            advertisedURL: nil,
            allowedOrigins: nil
        )
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(config).write(to: file, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return config
    }

    private static func randomToken() -> String {
        var generator = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        return Data(bytes).base64URLEncoded()
    }
}

extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
