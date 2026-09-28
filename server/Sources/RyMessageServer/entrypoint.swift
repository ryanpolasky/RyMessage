import Vapor

@main
struct Entrypoint {
    static func main() async throws {
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
