import Foundation

func normalizeHandle(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.contains("@") { return trimmed.lowercased() }
    let digits = trimmed.filter { $0.isASCII && $0.isNumber }
    if trimmed.hasPrefix("+") { return "+" + digits }
    if digits.count == 10 { return "+1" + digits }
    if digits.count == 11, digits.hasPrefix("1") { return "+" + digits }
    return digits
}

func fnv1a(_ data: Data) -> String {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in data {
        hash ^= UInt64(byte)
        hash = hash &* 0x0000_0100_0000_01b3
    }
    return String(hash, radix: 16)
}

// reads Contacts' own database so Full Disk Access is the only permission needed
final class ContactsBook: @unchecked Sendable {
    private struct Entry {
        let contact: Contact
        let photo: Data?
    }

    private let lock = NSLock()
    private var entries: [String: Entry] = [:]
    private var byHandle: [String: Contact] = [:]
    private var signature = ""
    private var version = ""

    private static var root: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/AddressBook", isDirectory: true)
    }

    private static func databaseFiles() -> [URL] {
        let fm = FileManager.default
        var files = [root.appendingPathComponent("AddressBook-v22.abcddb")]
        let sources = root.appendingPathComponent("Sources", isDirectory: true)
        if let children = try? fm.contentsOfDirectory(at: sources, includingPropertiesForKeys: nil) {
            files += children.map { $0.appendingPathComponent("AddressBook-v22.abcddb") }
        }
        return files.filter { fm.fileExists(atPath: $0.path) }
    }

    var isAvailable: Bool {
        Self.databaseFiles().contains { FileHandle(forReadingAtPath: $0.path) != nil }
    }

    var currentVersion: String {
        ensureLoaded()
        lock.lock()
        defer { lock.unlock() }
        return version
    }

    private static func currentSignature() -> String {
        databaseFiles()
            .flatMap { [$0.path, $0.path + "-wal"] }
            .compactMap { path -> String? in
                guard let attributes = try? FileManager.default.attributesOfItem(atPath: path) else { return nil }
                let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
                return "\(path):\(modified):\(size)"
            }
            .joined(separator: "|")
    }

    private func ensureLoaded() {
        lock.lock()
        let loaded = !signature.isEmpty
        lock.unlock()
        if !loaded { refreshIfChanged() }
    }

    @discardableResult
    func refreshIfChanged() -> Bool {
        let current = Self.currentSignature()
        lock.lock()
        let unchanged = !signature.isEmpty && current == signature
        lock.unlock()
        if unchanged { return false }
        let loaded = Self.load()
        lock.lock()
        entries = loaded.entries
        byHandle = loaded.byHandle
        signature = current.isEmpty ? "empty" : current
        version = fnv1a(Data(current.utf8))
        lock.unlock()
        return true
    }

    func contact(forHandle raw: String) -> Contact? {
        ensureLoaded()
        lock.lock()
        defer { lock.unlock() }
        return byHandle[normalizeHandle(raw)]
    }

    func photo(for id: String) -> Data? {
        ensureLoaded()
        lock.lock()
        defer { lock.unlock() }
        return entries[id]?.photo
    }

    func response(since clientVersion: String?) -> ContactsResponse {
        refreshIfChanged()
        lock.lock()
        defer { lock.unlock() }
        if clientVersion == version {
            return ContactsResponse(version: version, contacts: nil)
        }
        let contacts = entries.values.map(\.contact).sorted {
            $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
        }
        return ContactsResponse(version: version, contacts: contacts)
    }

    private static func load() -> (entries: [String: Entry], byHandle: [String: Contact]) {
        var entries: [String: Entry] = [:]
        var byHandle: [String: Contact] = [:]
        for (sourceIndex, file) in databaseFiles().enumerated() {
            guard let db = try? SQLiteConnection(path: file.path) else { continue }
            let columns = "Z_PK AS pk, ZFIRSTNAME AS first, ZLASTNAME AS last, ZORGANIZATION AS org, ZNICKNAME AS nick"
            let records = (try? db.query("SELECT \(columns), ZTHUMBNAILIMAGEDATA AS photo FROM ZABCDRECORD"))
                ?? (try? db.query("SELECT \(columns) FROM ZABCDRECORD"))
                ?? []
            var handles: [Int64: [String]] = [:]
            let phones = (try? db.query("SELECT ZOWNER AS owner, ZFULLNUMBER AS value FROM ZABCDPHONENUMBER")) ?? []
            let emails = (try? db.query("SELECT ZOWNER AS owner, ZADDRESS AS value FROM ZABCDEMAILADDRESS")) ?? []
            for row in phones + emails {
                guard let owner = row.int("owner"), let value = row.string("value") else { continue }
                let handle = normalizeHandle(value)
                if !handle.isEmpty, !(handles[owner]?.contains(handle) ?? false) {
                    handles[owner, default: []].append(handle)
                }
            }
            for record in records {
                guard let pk = record.int("pk"), let owned = handles[pk] else { continue }
                let fullName = [record.string("first"), record.string("last")]
                    .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                let displayName = fullName.isEmpty ? (record.string("org") ?? record.string("nick") ?? "") : fullName
                guard !displayName.isEmpty else { continue }
                let id = "\(sourceIndex)-\(pk)"
                let photo = record.data("photo").flatMap { imageData(from: $0, database: file) }
                let contact = Contact(
                    id: id,
                    displayName: displayName,
                    handles: owned,
                    avatarUrl: photo.map { "/v1/avatars/\(id)?v=\(fnv1a($0).prefix(10))" }
                )
                entries[id] = Entry(contact: contact, photo: photo)
                for handle in owned where byHandle[handle] == nil {
                    byHandle[handle] = contact
                }
            }
        }
        return (entries, byHandle)
    }

    // thumbnails are inline behind a prefix byte, or in an external support file
    private static func imageData(from blob: Data, database: URL) -> Data? {
        let bytes = [UInt8](blob)
        guard !bytes.isEmpty else { return nil }
        for signature in [[0xFF, 0xD8, 0xFF], [0x89, 0x50, 0x4E, 0x47]] as [[UInt8]] {
            if let start = firstIndex(of: signature, in: bytes, within: 16) {
                return Data(bytes[start...])
            }
        }
        if bytes[0] == 0x02 {
            let name = String(decoding: bytes.dropFirst().prefix { $0 != 0 }, as: UTF8.self)
            let external = database.deletingLastPathComponent()
                .appendingPathComponent(".AddressBook-v22_SUPPORT/_EXTERNAL_DATA")
                .appendingPathComponent(name)
            return try? Data(contentsOf: external)
        }
        return nil
    }

    private static func firstIndex(of pattern: [UInt8], in bytes: [UInt8], within limit: Int) -> Int? {
        let last = min(limit, bytes.count - pattern.count)
        guard last >= 0 else { return nil }
        for start in 0...last where Array(bytes[start..<start + pattern.count]) == pattern {
            return start
        }
        return nil
    }
}
