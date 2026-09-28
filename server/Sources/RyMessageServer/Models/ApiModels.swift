import Vapor

struct Capabilities: Content {
    var sendText: Bool
    var attachments: Bool
    var reactions: Bool
    var replies: Bool
    var editing: Bool
    var unsend: Bool
    var typingIndicators: Bool
    var markRead: Bool
}

struct CapabilitiesResponse: Content {
    var capabilities: Capabilities
}

enum Service: String, Content {
    case iMessage
    case sms = "SMS"
}

enum MessageStatus: String, Content {
    case sending
    case sent
    case delivered
    case read
    case failed
}

struct Participant: Content {
    var id: String
    var displayName: String?
    var handle: String
    var avatarUrl: String?
}

struct Attachment: Content {
    var id: String
    var mimeType: String
    var fileName: String
    var byteSize: Int
    var width: Int?
    var height: Int?
    var url: String
}

struct Message: Content {
    var id: String
    var conversationId: String
    var sender: Participant?
    var isFromMe: Bool
    var text: String?
    var attachments: [Attachment]
    var sentAt: Date
    var deliveredAt: Date?
    var readAt: Date?
    var service: Service
    var status: MessageStatus
    var clientId: String?
    var reactions: [Reaction]
    var replyTo: String?
}

enum TapbackKind: String, Content {
    case love
    case like
    case dislike
    case laugh
    case emphasize
    case question
}

struct Reaction: Content {
    var kind: TapbackKind
    var sender: Participant?
    var isFromMe: Bool
    var sentAt: Date
}

struct Conversation: Content {
    var id: String
    var displayName: String?
    var participants: [Participant]
    var isGroup: Bool
    var lastMessage: Message?
    var unreadCount: Int
    var service: Service
    var pinned: Bool
}

struct SendMessageRequest: Content {
    var clientId: String
    var text: String
    var replyTo: String?
}

struct SetReactionRequest: Content {
    var kind: TapbackKind?
}

enum BridgeEvent {
    case messageCreated(Message)
    case messageUpdated(Message)
    case conversationUpdated(Conversation)
}

extension BridgeEvent: Encodable {
    private enum CodingKeys: String, CodingKey {
        case type
        case message
        case conversation
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .messageCreated(let message):
            try container.encode("messageCreated", forKey: .type)
            try container.encode(message, forKey: .message)
        case .messageUpdated(let message):
            try container.encode("messageUpdated", forKey: .type)
            try container.encode(message, forKey: .message)
        case .conversationUpdated(let conversation):
            try container.encode("conversationUpdated", forKey: .type)
            try container.encode(conversation, forKey: .conversation)
        }
    }
}

struct ApiErrorBody: Content {
    struct Detail: Content {
        var code: String
        var message: String
    }

    var error: Detail
}

struct ApiError: AbortError {
    var status: HTTPResponseStatus
    var code: String
    var reason: String

    static func unauthorized(_ message: String = "Authentication required.") -> ApiError {
        ApiError(status: .unauthorized, code: "unauthorized", reason: message)
    }

    static func notFound(_ message: String = "Resource not found.") -> ApiError {
        ApiError(status: .notFound, code: "not_found", reason: message)
    }

    static func notSupported(_ message: String) -> ApiError {
        ApiError(status: .notImplemented, code: "not_supported", reason: message)
    }
}
