import Vapor

func routes(_ app: Application, provider: MessagesProvider, hub: EventHub, token: String) throws {
    let v1 = app.grouped("v1").grouped(BearerAuthMiddleware(token: token))

    v1.get("capabilities") { _ in
        CapabilitiesResponse(capabilities: provider.capabilities)
    }

    v1.get("conversations") { _ in
        try await provider.conversations()
    }

    v1.get("conversations", ":id", "messages") { req in
        let id = try req.parameters.require("id")
        let before = req.query[String.self, at: "before"]
        let limit = req.query[Int.self, at: "limit"] ?? 50
        return try await provider.messages(conversationId: id, before: before, limit: limit)
    }

    v1.post("conversations", ":id", "messages") { req -> Message in
        let id = try req.parameters.require("id")
        let body = try req.content.decode(SendMessageRequest.self)
        if body.replyTo != nil && !provider.capabilities.replies {
            throw ApiError.notSupported("Replies are not supported by this server.")
        }
        return try await provider.sendMessage(
            conversationId: id,
            clientId: body.clientId,
            text: body.text,
            replyTo: body.replyTo
        )
    }

    v1.post("messages") { req -> Message in
        let body = try req.content.decode(StartConversationRequest.self)
        let recipients = body.to.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !recipients.isEmpty else {
            throw ApiError.invalidRequest("At least one recipient is required.")
        }
        guard provider.capabilities.compose else {
            throw ApiError.notSupported("Starting conversations is not supported by this server.")
        }
        if recipients.count > 1 && !provider.capabilities.groupCompose {
            throw ApiError.notSupported("New group chats are not supported by this server.")
        }
        let (message, created) = try await provider.startConversation(
            clientId: body.clientId,
            to: recipients,
            text: body.text
        )
        if let created {
            await hub.broadcast(.conversationUpdated(created))
        }
        return message
    }

    v1.get("contacts") { req -> ContactsResponse in
        guard provider.capabilities.contacts else {
            throw ApiError.notSupported("Contacts are not supported by this server.")
        }
        return try await provider.contacts(since: req.query[String.self, at: "version"])
    }

    v1.get("avatars", ":contactId") { req -> Response in
        let contactId = try req.parameters.require("contactId")
        let (mimeType, data) = try await provider.avatar(contactId: contactId)
        let response = Response(status: .ok)
        response.headers.contentType = HTTPMediaType.parse(mimeType)
        response.headers.replaceOrAdd(name: .cacheControl, value: "private, max-age=31536000, immutable")
        response.body = .init(buffer: data)
        return response
    }

    v1.post("conversations", ":id", "messages", ":messageId", "reaction") { req -> Message in
        guard provider.capabilities.reactions else {
            throw ApiError.notSupported("Tapbacks are not supported by this server.")
        }
        let id = try req.parameters.require("id")
        let messageId = try req.parameters.require("messageId")
        let body = try req.content.decode(SetReactionRequest.self)
        let message = try await provider.setReaction(conversationId: id, messageId: messageId, kind: body.kind)
        await hub.broadcast(.messageUpdated(message))
        return message
    }

    v1.on(.POST, "conversations", ":id", "attachments", body: .collect(maxSize: "100mb")) { req in
        let id = try req.parameters.require("id")
        let clientId = try req.content.get(String.self, at: "clientId")
        let file = try req.content.get(File.self, at: "file")
        return try await provider.sendAttachment(
            conversationId: id,
            clientId: clientId,
            fileName: file.filename,
            mimeType: file.contentType?.serialize() ?? "application/octet-stream",
            data: file.data
        )
    }

    v1.post("conversations", ":id", "read") { req -> HTTPStatus in
        let id = try req.parameters.require("id")
        try await provider.markRead(conversationId: id)
        return .noContent
    }

    v1.get("attachments", ":id") { req -> Response in
        let id = try req.parameters.require("id")
        let (attachment, data) = try await provider.attachmentData(id: id)
        let response = Response(status: .ok)
        response.headers.contentType = HTTPMediaType.parse(attachment.mimeType)
        response.headers.contentDisposition = .init(.attachment, filename: attachment.fileName)
        response.headers.replaceOrAdd(name: .cacheControl, value: "private, max-age=31536000, immutable")
        response.body = .init(buffer: data)
        return response
    }

    app.grouped("v1").webSocket("events") { req, socket in
        socket.pingInterval = .seconds(25)
        if req.headers.bearerAuthorization?.token == token {
            await hub.add(socket)
            return
        }
        let state = SocketAuthState()
        let timeout = req.eventLoop.scheduleTask(in: .seconds(10)) {
            if !state.authenticated {
                _ = socket.close(code: .policyViolation)
            }
        }
        socket.onText { socket, text in
            if state.authenticated { return }
            guard let data = text.data(using: .utf8),
                  let auth = try? JSONDecoder().decode(SocketAuth.self, from: data),
                  auth.type == "auth",
                  auth.token == token
            else {
                timeout.cancel()
                _ = socket.close(code: .policyViolation)
                return
            }
            state.authenticated = true
            timeout.cancel()
            Task { await hub.add(socket) }
        }
    }
}

private struct SocketAuth: Decodable {
    let type: String
    let token: String
}

private final class SocketAuthState {
    var authenticated = false
}

extension HTTPMediaType {
    static func parse(_ value: String) -> HTTPMediaType? {
        let parts = value.split(separator: "/", maxSplits: 1)
        guard parts.count == 2 else { return nil }
        return HTTPMediaType(type: String(parts[0]), subType: String(parts[1]))
    }
}
