import Foundation
import UniformTypeIdentifiers
import Vapor

actor MessagesStore {
    private struct Pending {
        let clientId: String
        let text: String?
        let message: Message
        let createdAt: Date
    }

    struct SendTarget: Sendable {
        let chatId: Int64
        let guid: String
        let handle: String?
    }

    private static let messageColumns = """
        m.ROWID AS rowid, m.guid AS guid, m.text AS text, m.attributedBody AS body, m.handle_id AS handle_id, \
        m.service AS service, m.date AS date, m.date_delivered AS date_delivered, m.date_read AS date_read, \
        m.is_from_me AS is_from_me, m.is_delivered AS is_delivered, m.is_sent AS is_sent, m.error AS error, \
        m.cache_has_attachments AS has_attachments, m.thread_originator_guid AS thread_originator_guid, \
        m.associated_message_guid AS associated_guid, m.associated_message_type AS associated_type, \
        m.item_type AS item_type, cmj.chat_id AS chat_id
        """
    private static let pendingTimeout: TimeInterval = 60
    private static let statusWindow: Int64 = 400

    static var databasePath: String {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Messages/chat.db").path
    }

    static func canOpenDatabase() -> Bool {
        FileHandle(forReadingAtPath: databasePath) != nil
    }

    private let contacts: ContactsBook
    private var database: SQLiteConnection?
    private var participants: [Int64: Participant] = [:]
    private var lastRowID: Int64?
    private var outgoingSignatures: [String: String] = [:]
    private var pending: [Int64: [Pending]] = [:]
    private var pollCount = 0

    init(contacts: ContactsBook) {
        self.contacts = contacts
    }

    private func connection() throws -> SQLiteConnection {
        if let database { return database }
        do {
            let opened = try SQLiteConnection(path: Self.databasePath)
            _ = try opened.query("SELECT ROWID FROM message LIMIT 1")
            database = opened
            return opened
        } catch {
            throw ApiError.permissionRequired(
                "RyMessage can't read your messages yet. On the Mac, turn on Full Disk Access for rymessage-server in System Settings > Privacy & Security, then run ./install.sh again."
            )
        }
    }

    func conversations() throws -> [Conversation] {
        let rows = try connection().query("""
            SELECT chat_rowid, last_date FROM (
                SELECT c.ROWID AS chat_rowid, (SELECT MAX(message_date) FROM chat_message_join WHERE chat_id = c.ROWID) AS last_date
                FROM chat c
            ) WHERE last_date IS NOT NULL ORDER BY last_date DESC LIMIT 150
            """)
        return try rows.compactMap { $0.int("chat_rowid") }.map { try conversation($0) }
    }

    func conversation(_ chatId: Int64) throws -> Conversation {
        let chat = try chatRow(chatId)
        let memberRows = try connection().query(
            "SELECT handle_id AS handle_id FROM chat_handle_join WHERE chat_id = ?", [.int(chatId)]
        )
        var members = try memberRows.compactMap { $0.int("handle_id") }.compactMap { try participant($0) }
        if members.isEmpty, let identifier = chat.string("identifier") {
            members = [directParticipant(identifier)]
        }
        let unread = try connection().query("""
            SELECT COUNT(*) AS count FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
            WHERE cmj.chat_id = ? AND m.is_from_me = 0 AND m.is_read = 0 AND m.item_type = 0 AND m.associated_message_type = 0
            """, [.int(chatId)]).first?.int("count") ?? 0
        let last = try messages(chatId: chatId, before: nil, limit: 1).first
        let name = chat.string("display_name").flatMap { $0.isEmpty ? nil : $0 }
        return Conversation(
            id: String(chatId),
            displayName: name,
            participants: members,
            isGroup: chat.int("style") == 43,
            lastMessage: last,
            unreadCount: Int(unread),
            service: Self.service(chat.string("service")) ?? .iMessage,
            pinned: false
        )
    }

    func messages(conversationId: String, before: String?, limit: Int) throws -> [Message] {
        guard let chatId = Int64(conversationId) else { throw ApiError.notFound("Conversation not found.") }
        return try messages(chatId: chatId, before: before, limit: limit)
    }

    private func messages(chatId: Int64, before: String?, limit: Int) throws -> [Message] {
        let chat = try chatRow(chatId)
        var sql = """
            SELECT \(Self.messageColumns) FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
            WHERE cmj.chat_id = ? AND m.associated_message_type = 0 AND m.item_type = 0
            """
        var parameters: [SQLiteValue] = [.int(chatId)]
        if let before {
            sql += " AND m.date < (SELECT date FROM message WHERE guid = ?)"
            parameters.append(.text(before))
        }
        sql += " ORDER BY m.date DESC LIMIT ?"
        parameters.append(.int(Int64(max(1, min(limit, 200)))))
        let rows = try connection().query(sql, parameters)
        return try build(rows, chatId: chatId, chatService: Self.service(chat.string("service")))
    }

    func attachmentData(id: String) throws -> (Attachment, Data) {
        guard let rowid = Int64(id),
              let row = try connection().query(
                  "SELECT filename AS filename, mime_type AS mime_type, transfer_name AS transfer_name FROM attachment WHERE ROWID = ?",
                  [.int(rowid)]
              ).first,
              let path = row.string("filename")
        else { throw ApiError.notFound("Attachment not found.") }
        let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        let name = row.string("transfer_name") ?? url.lastPathComponent
        let data: Data
        if ["heic", "heif"].contains(url.pathExtension.lowercased()) {
            guard let converted = ImageConversion.jpeg(from: url, cacheKey: id) else {
                throw ApiError.notFound("This photo hasn't finished downloading on the Mac yet.")
            }
            data = converted
        } else {
            guard let contents = try? Data(contentsOf: url) else {
                throw ApiError.notFound("This attachment hasn't finished downloading on the Mac yet.")
            }
            data = contents
        }
        let attachment = Attachment(
            id: id,
            mimeType: Self.mimeType(declared: row.string("mime_type"), fileName: url.lastPathComponent),
            fileName: name,
            byteSize: data.count,
            width: nil,
            height: nil,
            url: "/v1/attachments/\(id)"
        )
        return (attachment, data)
    }

    func sendTarget(_ conversationId: String) throws -> SendTarget {
        guard let chatId = Int64(conversationId) else { throw ApiError.notFound("Conversation not found.") }
        let chat = try chatRow(chatId)
        guard let guid = chat.string("guid") else { throw ApiError.notFound("Conversation not found.") }
        return SendTarget(chatId: chatId, guid: guid, handle: chat.int("style") == 45 ? chat.string("identifier") : nil)
    }

    func directChat(with handle: String) throws -> Int64? {
        let key = normalizeHandle(handle)
        let rows = try connection().query("""
            SELECT c.ROWID AS rowid, c.chat_identifier AS identifier FROM chat c WHERE c.style = 45
            ORDER BY (SELECT MAX(message_date) FROM chat_message_join WHERE chat_id = c.ROWID) DESC
            """)
        let match = rows.first(where: { $0.string("identifier").map(normalizeHandle) == key })
        return match?.int("rowid")
    }

    func placeholder(chatId: Int64, clientId: String, text: String?) throws -> Message {
        let chat = try chatRow(chatId)
        return Message(
            id: "pending-\(clientId)",
            conversationId: String(chatId),
            sender: nil,
            isFromMe: true,
            text: text,
            attachments: [],
            sentAt: Date(),
            deliveredAt: nil,
            readAt: nil,
            service: Self.service(chat.string("service")) ?? .iMessage,
            status: .sending,
            clientId: clientId,
            reactions: [],
            replyTo: nil
        )
    }

    // registered before handing off to Messages so the watcher can't see the row first
    func expectSend(chatId: Int64, clientId: String, text: String?) throws -> Message {
        let message = try placeholder(chatId: chatId, clientId: clientId, text: text)
        pending[chatId, default: []].append(Pending(clientId: clientId, text: text, message: message, createdAt: Date()))
        return message
    }

    func cancelSend(chatId: Int64, clientId: String) {
        pending[chatId]?.removeAll { $0.clientId == clientId }
    }

    func poll() throws -> [BridgeEvent] {
        let db = try connection()
        pollCount += 1
        var events: [BridgeEvent] = []
        if pollCount % 30 == 0, contacts.refreshIfChanged() {
            participants.removeAll()
            events.append(.contactsChanged(version: contacts.currentVersion))
        }
        guard let last = lastRowID else {
            let newest = try db.query("SELECT MAX(ROWID) AS newest FROM message").first?.int("newest") ?? 0
            lastRowID = newest
            outgoingSignatures = try outgoingStatus(since: newest - Self.statusWindow)
            return events
        }

        let rows = try db.query(
            "SELECT \(Self.messageColumns) FROM message m JOIN chat_message_join cmj ON cmj.message_id = m.ROWID WHERE m.ROWID > ? ORDER BY m.ROWID ASC LIMIT 500",
            [.int(last)]
        )
        var newest = last
        var touchedChats: [Int64] = []
        var reactionTargets: [String] = []
        for row in rows {
            guard let rowid = row.int("rowid"), let chatId = row.int("chat_id") else { continue }
            newest = max(newest, rowid)
            let type = row.int("associated_type") ?? 0
            if (2000...3005).contains(type), let target = row.string("associated_guid") {
                let guid = Self.targetGuid(target)
                if !reactionTargets.contains(guid) { reactionTargets.append(guid) }
            } else if type == 0, row.int("item_type") == 0 {
                let chat = try chatRow(chatId)
                guard var message = try build([row], chatId: chatId, chatService: Self.service(chat.string("service"))).first else {
                    continue
                }
                if message.isFromMe {
                    message.clientId = claimPending(chatId: chatId, text: message.text)
                }
                events.append(.messageCreated(message))
            } else {
                continue
            }
            if !touchedChats.contains(chatId) { touchedChats.append(chatId) }
        }
        lastRowID = newest

        for guid in reactionTargets {
            if let updated = try fetchMessage(guid: guid) { events.append(.messageUpdated(updated)) }
        }

        let signatures = try outgoingStatus(since: newest - Self.statusWindow)
        for (guid, signature) in signatures {
            guard let previous = outgoingSignatures[guid], previous != signature else { continue }
            if let updated = try fetchMessage(guid: guid) { events.append(.messageUpdated(updated)) }
        }
        outgoingSignatures = signatures

        events += expirePending()
        for chatId in touchedChats {
            let updated = try conversation(chatId)
            events.append(.conversationUpdated(updated))
        }
        return events
    }

    private func claimPending(chatId: Int64, text: String?) -> String? {
        guard var list = pending[chatId], !list.isEmpty else { return nil }
        let exact = list.firstIndex(where: { $0.text == text })
        guard let index = exact ?? list.firstIndex(where: { ($0.text == nil) == (text == nil) }) else { return nil }
        let claimed = list.remove(at: index)
        pending[chatId] = list.isEmpty ? nil : list
        return claimed.clientId
    }

    private func expirePending() -> [BridgeEvent] {
        let cutoff = Date().addingTimeInterval(-Self.pendingTimeout)
        var events: [BridgeEvent] = []
        for (chatId, list) in pending {
            for item in list where item.createdAt < cutoff {
                var failed = item.message
                failed.status = .failed
                events.append(.messageUpdated(failed))
            }
            let fresh = list.filter { $0.createdAt >= cutoff }
            pending[chatId] = fresh.isEmpty ? nil : fresh
        }
        return events
    }

    private func outgoingStatus(since rowid: Int64) throws -> [String: String] {
        let rows = try connection().query("""
            SELECT guid AS guid, date_delivered AS delivered_at, date_read AS read_at, is_delivered AS is_delivered, \
            is_sent AS is_sent, error AS error
            FROM message WHERE is_from_me = 1 AND associated_message_type = 0 AND ROWID > ?
            """, [.int(rowid)])
        var result: [String: String] = [:]
        for row in rows {
            guard let guid = row.string("guid") else { continue }
            let parts = ["delivered_at", "read_at", "is_delivered", "is_sent", "error"].map { String(row.int($0) ?? 0) }
            result[guid] = parts.joined(separator: "|")
        }
        return result
    }

    private func fetchMessage(guid: String) throws -> Message? {
        guard let row = try connection().query(
            "SELECT \(Self.messageColumns) FROM message m JOIN chat_message_join cmj ON cmj.message_id = m.ROWID WHERE m.guid = ?",
            [.text(guid)]
        ).first, let chatId = row.int("chat_id") else { return nil }
        let chat = try chatRow(chatId)
        return try build([row], chatId: chatId, chatService: Self.service(chat.string("service"))).first
    }

    private func chatRow(_ chatId: Int64) throws -> SQLiteRow {
        guard let row = try connection().query("""
            SELECT ROWID AS rowid, guid AS guid, chat_identifier AS identifier, service_name AS service, \
            display_name AS display_name, style AS style FROM chat WHERE ROWID = ?
            """, [.int(chatId)]).first
        else { throw ApiError.notFound("Conversation not found.") }
        return row
    }

    private func build(_ rows: [SQLiteRow], chatId: Int64, chatService: Service?) throws -> [Message] {
        let withFiles = rows.filter { $0.int("has_attachments") == 1 }.compactMap { $0.int("rowid") }
        let files = try attachments(for: withFiles)
        let oldest = rows.compactMap { $0.int("date") }.min() ?? 0
        let tapbacks = try reactions(chatId: chatId, since: oldest, targets: Set(rows.compactMap { $0.string("guid") }))
        return try rows.compactMap { row -> Message? in
            guard let rowid = row.int("rowid"), let guid = row.string("guid") else { return nil }
            let fromMe = row.int("is_from_me") == 1
            let text = Self.messageText(row)
            let attached = files[rowid] ?? []
            if text == nil && attached.isEmpty { return nil }
            let sender = try fromMe ? nil : participant(row.int("handle_id") ?? 0)
            return Message(
                id: guid,
                conversationId: String(chatId),
                sender: sender,
                isFromMe: fromMe,
                text: text,
                attachments: attached,
                sentAt: Self.appleDate(row.int("date")) ?? Date(),
                deliveredAt: Self.appleDate(row.int("date_delivered")),
                readAt: Self.appleDate(row.int("date_read")),
                service: Self.service(row.string("service")) ?? chatService ?? .iMessage,
                status: fromMe ? Self.outgoingState(row) : .sent,
                clientId: nil,
                reactions: tapbacks[guid] ?? [],
                replyTo: row.string("thread_originator_guid").flatMap { $0.isEmpty ? nil : $0 }
            )
        }
    }

    private func participant(_ handleId: Int64) throws -> Participant? {
        guard handleId != 0 else { return nil }
        if let known = participants[handleId] { return known }
        for row in try connection().query("SELECT ROWID AS rowid, id AS id FROM handle") {
            guard let rowid = row.int("rowid"), let raw = row.string("id") else { continue }
            participants[rowid] = directParticipant(raw)
        }
        return participants[handleId]
    }

    private func directParticipant(_ raw: String) -> Participant {
        let contact = contacts.contact(forHandle: raw)
        return Participant(id: normalizeHandle(raw), displayName: contact?.displayName, handle: raw, avatarUrl: contact?.avatarUrl)
    }

    private func attachments(for rowids: [Int64]) throws -> [Int64: [Attachment]] {
        guard !rowids.isEmpty else { return [:] }
        let placeholders = Array(repeating: "?", count: rowids.count).joined(separator: ",")
        let rows = try connection().query("""
            SELECT maj.message_id AS message_id, a.ROWID AS rowid, a.filename AS filename, a.mime_type AS mime_type, \
            a.transfer_name AS transfer_name, a.total_bytes AS total_bytes
            FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id
            WHERE maj.message_id IN (\(placeholders))
            """, rowids.map { SQLiteValue.int($0) })
        var result: [Int64: [Attachment]] = [:]
        for row in rows {
            guard let messageId = row.int("message_id"), let rowid = row.int("rowid") else { continue }
            let fileName = row.string("filename").map { URL(fileURLWithPath: $0).lastPathComponent }
            let name = row.string("transfer_name") ?? fileName ?? "Attachment"
            if name.hasSuffix(".pluginPayloadAttachment") { continue }
            result[messageId, default: []].append(Attachment(
                id: String(rowid),
                mimeType: Self.mimeType(declared: row.string("mime_type"), fileName: fileName ?? name),
                fileName: name,
                byteSize: Int(row.int("total_bytes") ?? 0),
                width: nil,
                height: nil,
                url: "/v1/attachments/\(rowid)"
            ))
        }
        return result
    }

    // tapbacks are their own rows pointing at a target; replaying them in order leaves each person's current one
    private func reactions(chatId: Int64, since date: Int64, targets: Set<String>) throws -> [String: [Reaction]] {
        guard !targets.isEmpty else { return [:] }
        let rows = try connection().query("""
            SELECT m.associated_message_guid AS target, m.associated_message_type AS type, m.is_from_me AS is_from_me, \
            m.handle_id AS handle_id, m.date AS date
            FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
            WHERE cmj.chat_id = ? AND m.associated_message_type BETWEEN 2000 AND 3005 AND m.date >= ?
            ORDER BY m.date ASC
            """, [.int(chatId), .int(date)])
        var state: [String: [String: Reaction]] = [:]
        for row in rows {
            guard let raw = row.string("target"), let type = row.int("type") else { continue }
            let target = Self.targetGuid(raw)
            guard targets.contains(target), let kind = Self.tapback(Int(type % 1000)) else { continue }
            let fromMe = row.int("is_from_me") == 1
            let reactor = fromMe ? "me" : String(row.int("handle_id") ?? 0)
            if type < 3000 {
                let sender = try fromMe ? nil : participant(row.int("handle_id") ?? 0)
                state[target, default: [:]][reactor] = Reaction(
                    kind: kind,
                    sender: sender,
                    isFromMe: fromMe,
                    sentAt: Self.appleDate(row.int("date")) ?? Date()
                )
            } else if state[target]?[reactor]?.kind == kind {
                state[target]?[reactor] = nil
            }
        }
        return state.mapValues { byReactor in byReactor.values.sorted { $0.sentAt < $1.sentAt } }
    }

    private static func appleDate(_ raw: Int64?) -> Date? {
        guard let raw, raw != 0 else { return nil }
        let seconds = raw > 1_000_000_000_000 ? Double(raw) / 1_000_000_000 : Double(raw)
        return Date(timeIntervalSinceReferenceDate: seconds)
    }

    private static func service(_ raw: String?) -> Service? {
        guard let raw else { return nil }
        return raw == "iMessage" ? .iMessage : .sms
    }

    private static func outgoingState(_ row: SQLiteRow) -> MessageStatus {
        if (row.int("error") ?? 0) != 0 { return .failed }
        if (row.int("date_read") ?? 0) != 0 { return .read }
        if row.int("is_delivered") == 1 || (row.int("date_delivered") ?? 0) != 0 { return .delivered }
        if row.int("is_sent") == 1 { return .sent }
        return .sending
    }

    private static func tapback(_ code: Int) -> TapbackKind? {
        switch code {
        case 0: return .love
        case 1: return .like
        case 2: return .dislike
        case 3: return .laugh
        case 4: return .emphasize
        case 5: return .question
        default: return nil
        }
    }

    private static func targetGuid(_ raw: String) -> String {
        if let slash = raw.lastIndex(of: "/") { return String(raw[raw.index(after: slash)...]) }
        if raw.hasPrefix("bp:") { return String(raw.dropFirst(3)) }
        return raw
    }

    private static func mimeType(declared: String?, fileName: String) -> String {
        let ext = (fileName as NSString).pathExtension.lowercased()
        if ["heic", "heif"].contains(ext) { return "image/jpeg" }
        if let declared, !declared.isEmpty { return declared }
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    private static func messageText(_ row: SQLiteRow) -> String? {
        var text = row.string("text")
        if text?.isEmpty ?? true, let body = row.data("body") {
            text = decodeAttributedBody(body)
        }
        let cleaned = text?
            .replacingOccurrences(of: "\u{FFFC}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned?.isEmpty == false ? cleaned : nil
    }

    // newer macOS leaves `text` empty and keeps the string inside an archived NSAttributedString
    private static func decodeAttributedBody(_ data: Data) -> String? {
        let bytes = [UInt8](data)
        let marker = Array("NSString".utf8)
        guard bytes.count > marker.count,
              let found = (0...(bytes.count - marker.count)).first(where: { Array(bytes[$0..<$0 + marker.count]) == marker })
        else { return nil }
        var index = found + marker.count + 5
        guard index < bytes.count else { return nil }
        let length: Int
        switch bytes[index] {
        case 0x81:
            guard index + 2 < bytes.count else { return nil }
            length = Int(bytes[index + 1]) | Int(bytes[index + 2]) << 8
            index += 3
        case 0x82:
            guard index + 4 < bytes.count else { return nil }
            length = Int(bytes[index + 1]) | Int(bytes[index + 2]) << 8 | Int(bytes[index + 3]) << 16 | Int(bytes[index + 4]) << 24
            index += 5
        default:
            length = Int(bytes[index])
            index += 1
        }
        guard length > 0, index + length <= bytes.count else { return nil }
        return String(decoding: bytes[index..<index + length], as: UTF8.self)
    }
}
