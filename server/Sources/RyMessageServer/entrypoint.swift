import Vapor

@main
struct Entrypoint {
    static func main() async throws {
        let arguments = CommandLine.arguments
        if arguments.contains("--pairing-code") {
            let config = try ConfigStore.loadOrCreate()
            print(Pairing.code(url: Pairing.advertisedURL(config: config), token: config.token))
            return
        }
        if let flag = arguments.firstIndex(of: "--set-port"), flag + 1 < arguments.count, let port = Int(arguments[flag + 1]) {
            var config = try ConfigStore.loadOrCreate()
            if let url = config.advertisedURL, url.hasSuffix(":\(config.port)") {
                config.advertisedURL = String(url.dropLast(":\(config.port)".count)) + ":\(port)"
            }
            config.port = port
            try ConfigStore.save(config)
            print("RyMessage will listen on port \(port)")
            return
        }
        if let flag = arguments.firstIndex(of: "--set-advertised-url"), flag + 1 < arguments.count {
            var config = try ConfigStore.loadOrCreate()
            config.advertisedURL = arguments[flag + 1]
            try ConfigStore.save(config)
            print("Pairing codes now point at \(arguments[flag + 1])")
            return
        }

        let env = try Environment.detect()
        let app = try await Application.make(env)
        do {
            try configure(app)
            try await app.execute()
        } catch {
            app.logger.report(error: error)
            try await app.asyncShutdown()
            throw error
        }
        try await app.asyncShutdown()
    }
}
