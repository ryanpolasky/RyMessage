import Vapor

struct ApiErrorMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        do {
            return try await next.respond(to: request)
        } catch let error as ApiError {
            return try encode(status: error.status, code: error.code, message: error.reason, for: request)
        } catch let error as AbortError {
            return try encode(
                status: error.status,
                code: error.status == .notFound ? "not_found" : "internal",
                message: error.reason,
                for: request
            )
        } catch {
            request.logger.report(error: error)
            return try encode(
                status: .internalServerError,
                code: "internal",
                message: "Internal server error.",
                for: request
            )
        }
    }

    private func encode(
        status: HTTPResponseStatus,
        code: String,
        message: String,
        for request: Request
    ) throws -> Response {
        let body = ApiErrorBody(error: .init(code: code, message: message))
        let response = Response(status: status)
        try response.content.encode(body)
        return response
    }
}
