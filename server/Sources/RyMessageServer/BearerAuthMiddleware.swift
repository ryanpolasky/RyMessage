import Vapor

struct BearerAuthMiddleware: AsyncMiddleware {
    let token: String

    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard request.headers.bearerAuthorization?.token == token else {
            throw ApiError.unauthorized()
        }
        return try await next.respond(to: request)
    }
}
