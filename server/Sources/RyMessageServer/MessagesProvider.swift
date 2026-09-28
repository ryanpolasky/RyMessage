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
    func startConversation(clientId: String, to: [String], text: String) async throws -> (message: Message, created: Conversation?)
    func contacts(since version: String?) async throws -> ContactsResponse
    func avatar(contactId: String) async throws -> (mimeType: String, data: ByteBuffer)
}

struct ChatDBProvider: MessagesProvider {
    private let contactsBook: ContactsBook
    private let store: MessagesStore
    private let logger: Logger

    init(logger: Logger) {
        let book = ContactsBook()
        contactsBook = book
        store = MessagesStore(contacts: book)
        self.logger = logger
    }

    var capabilities: Capabilities {
        let canRead = MessagesStore.canOpenDatabase()
        return Capabilities(
            sendText: canRead,
            attachments: canRead,
            reactions: false,
            replies: false,
            editing: false,
            unsend: false,
            typingIndicators: false,
            markRead: false,
            compose: canRead,
            groupCompose: false,
            contacts: contactsBook.isAvailable
        )
    }

    func conversations() async throws -> [Conversation] {
        try await store.conversations()
    }

    func messages(conversationId: String, before: String?, limit: Int) async throws -> [Message] {
        try await store.messages(conversationId: conversationId, before: before, limit: limit)
    }

    func sendMessage(conversationId: String, clientId: String, text: String, replyTo: String?) async throws -> Message {
        guard replyTo == nil else {
            throw ApiError.notSupported("Replies need Apple's private API, which this server doesn't use.")
        }
        let target = try await store.sendTarget(conversationId)
        let placeholder = try await store.expectSend(conversationId: target.conversationId, clientId: clientId, text: text)
        do {
            try await MessagesApp.send(text: text, chatGuid: target.guid, fallbackHandle: target.handle)
        } catch {
            await store.cancelSend(conversationId: target.conversationId, clientId: clientId)
            logger.warning("Sending through Messages failed: \(error)")
            throw ApiError.sendFailed("Messages couldn't send that: \(error)")
        }
        return placeholder
    }

    func setReaction(conversationId: String, messageId: String, kind: TapbackKind?) async throws -> Message {
        throw ApiError.notSupported("Tapbacks need Apple's private API, which this server doesn't use.")
    }

    func sendAttachment(
        conversationId: String,
        clientId: String,
        fileName: String,
        mimeType: String,
        data: ByteBuffer
    ) async throws -> Message {
        let target = try await store.sendTarget(conversationId)
        // Messages only reliably picks up files from inside the user's home folders
        let folder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Pictures/RyMessage", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let safeName = fileName.replacingOccurrences(of: "/", with: "_")
        let file = folder.appendingPathComponent("\(UUID().uuidString.prefix(8))-\(safeName)")
        try Data(data.readableBytesView).write(to: file)
        let placeholder = try await store.expectSend(conversationId: target.conversationId, clientId: clientId, text: nil)
        do {
            try await MessagesApp.send(file: file, chatGuid: target.guid)
        } catch {
            await store.cancelSend(conversationId: target.conversationId, clientId: clientId)
            logger.warning("Sending a file through Messages failed: \(error)")
            throw ApiError.sendFailed("Messages couldn't send that file: \(error)")
        }
        return placeholder
    }

    func markRead(conversationId: String) async throws {
        throw ApiError.notSupported("Marking conversations read needs Apple's private API, which this server doesn't use.")
    }

    func attachmentData(id: String) async throws -> (Attachment, ByteBuffer) {
        let file = try await store.attachmentFile(id: id)
        guard FileManager.default.fileExists(atPath: file.url.path) else {
            throw ApiError.notFound("This attachment hasn't finished downloading on the Mac yet.")
        }
        guard let data = await MediaConversion.servedData(for: file.url, cacheKey: id) else {
            logger.warning("Couldn't convert attachment \(id) (\(file.url.pathExtension)) for the browser")
            throw ApiError.notFound("This attachment couldn't be converted for playback.")
        }
        let attachment = Attachment(
            id: id,
            mimeType: MediaConversion.servedMimeType(declared: file.declaredMimeType, fileName: file.url.lastPathComponent),
            fileName: file.fileName,
            byteSize: data.count,
            width: nil,
            height: nil,
            url: "/v1/attachments/\(id)"
        )
        return (attachment, ByteBuffer(bytes: data))
    }

    func startConversation(clientId: String, to: [String], text: String) async throws -> (message: Message, created: Conversation?) {
        let handle = normalizeHandle(to[0])
        if let existing = try await store.directConversation(with: handle) {
            let message = try await sendMessage(conversationId: existing, clientId: clientId, text: text, replyTo: nil)
            return (message, nil)
        }
        do {
            try await MessagesApp.send(text: text, toHandle: handle)
        } catch {
            logger.warning("Starting a conversation through Messages failed: \(error)")
            throw ApiError.sendFailed("Messages couldn't start a conversation with \(handle): \(error)")
        }
        for _ in 0..<20 {
            try await Task.sleep(nanoseconds: 500_000_000)
            if let created = try await store.directConversation(with: handle) {
                let message = try await store.placeholder(conversationId: created, clientId: clientId, text: text)
                let conversation = try await store.conversation(id: created)
                return (message, conversation)
            }
        }
        throw ApiError.sendFailed("Messages didn't start a conversation with \(handle). Check the number or address.")
    }

    func contacts(since version: String?) async throws -> ContactsResponse {
        contactsBook.response(since: version)
    }

    func avatar(contactId: String) async throws -> (mimeType: String, data: ByteBuffer) {
        guard let photo = contactsBook.photo(for: contactId) else {
            throw ApiError.notFound("This contact has no photo.")
        }
        let mimeType = photo.starts(with: [0x89, 0x50, 0x4E, 0x47]) ? "image/png" : "image/jpeg"
        return (mimeType, ByteBuffer(bytes: photo))
    }

    func startWatching(hub: EventHub, logger: Logger) {
        let store = self.store
        if MessagesStore.canOpenDatabase() {
            logger.info("Reading messages from \(MessagesStore.databasePath)")
        } else {
            logger.warning("Full Disk Access is missing, so messages can't be read yet. Run ./install.sh for guided setup.")
        }
        Task {
            var lastFailure = ""
            while true {
                do {
                    for event in try await store.poll() {
                        await hub.broadcast(event)
                    }
                    lastFailure = ""
                } catch {
                    let failure = String(describing: error)
                    if failure != lastFailure {
                        logger.warning("Watching for new messages failed: \(failure)")
                        lastFailure = failure
                    }
                }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
        Task {
            do {
                try await MessagesApp.checkAccess()
                logger.info("Messages automation is allowed.")
            } catch {
                logger.warning("Messages automation isn't allowed yet (\(error)). Approve the prompt on the Mac, or allow it in System Settings > Privacy & Security > Automation.")
            }
        }
    }
}
