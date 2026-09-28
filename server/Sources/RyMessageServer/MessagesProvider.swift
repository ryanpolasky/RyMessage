import Vapor

protocol MessagesProvider: Sendable {
    var capabilities: Capabilities { get }
    func conversations() async throws -> [Conversation]
    func messages(conversationId: String, before: String?, limit: Int) async throws -> [Message]
    func sendMessage(conversationId: String, clientId: String, text: String, replyTo: String?) async throws -> Message
    func setReaction(conversationId: String, messageId: String, kind: TapbackKind?) async throws -> Message
    func sendAttachment(
        conversationId: String,
        clientId: String,
        fileName: String,
        mimeType: String,
        data: ByteBuffer
    ) async throws -> Message
    func markRead(conversationId: String) async throws
    func attachmentData(id: String) async throws -> (Attachment, ByteBuffer)
}

struct ChatDBProvider: MessagesProvider {
    var capabilities: Capabilities {
        Capabilities(
            sendText: false,
            attachments: false,
            reactions: false,
            replies: false,
            editing: false,
            unsend: false,
            typingIndicators: false,
            markRead: false
        )
    }

    func conversations() async throws -> [Conversation] {
        throw ApiError.notSupported("Reading conversations from chat.db is not implemented yet.")
    }

    func messages(conversationId: String, before: String?, limit: Int) async throws -> [Message] {
        throw ApiError.notSupported("Reading messages from chat.db is not implemented yet.")
    }

    func sendMessage(conversationId: String, clientId: String, text: String, replyTo: String?) async throws -> Message {
        throw ApiError.notSupported("Sending messages is not implemented yet.")
    }

    func setReaction(conversationId: String, messageId: String, kind: TapbackKind?) async throws -> Message {
        throw ApiError.notSupported("Sending tapbacks is not implemented yet.")
    }

    func sendAttachment(
        conversationId: String,
        clientId: String,
        fileName: String,
        mimeType: String,
        data: ByteBuffer
    ) async throws -> Message {
        throw ApiError.notSupported("Sending attachments is not implemented yet.")
    }

    func markRead(conversationId: String) async throws {
        throw ApiError.notSupported("Marking conversations read is not implemented yet.")
    }

    func attachmentData(id: String) async throws -> (Attachment, ByteBuffer) {
        throw ApiError.notSupported("Attachment access is not implemented yet.")
    }
}
