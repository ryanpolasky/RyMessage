import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct SQLiteError: Error, CustomStringConvertible {
    let description: String
}

enum SQLiteValue {
    case int(Int64)
    case text(String)
}

private enum SQLiteColumn {
    case null
    case int(Int64)
    case double(Double)
    case text(String)
    case blob(Data)
}

struct SQLiteRow {
    private let columns: [String: SQLiteColumn]

    fileprivate init(_ statement: OpaquePointer) {
        var columns: [String: SQLiteColumn] = [:]
        for index in 0..<sqlite3_column_count(statement) {
            guard let namePointer = sqlite3_column_name(statement, index) else { continue }
            let name = String(cString: namePointer)
            switch sqlite3_column_type(statement, index) {
            case SQLITE_INTEGER:
                columns[name] = .int(sqlite3_column_int64(statement, index))
            case SQLITE_FLOAT:
                columns[name] = .double(sqlite3_column_double(statement, index))
            case SQLITE_TEXT:
                if let text = sqlite3_column_text(statement, index) {
                    columns[name] = .text(String(cString: text))
                }
            case SQLITE_BLOB:
                let count = Int(sqlite3_column_bytes(statement, index))
                if count > 0, let bytes = sqlite3_column_blob(statement, index) {
                    columns[name] = .blob(Data(bytes: bytes, count: count))
                }
            default:
                columns[name] = .null
            }
        }
        self.columns = columns
    }

    func int(_ name: String) -> Int64? {
        switch columns[name] {
        case .int(let value): return value
        case .double(let value): return Int64(value)
        default: return nil
        }
    }

    func string(_ name: String) -> String? {
        if case .text(let value) = columns[name] { return value }
        return nil
    }

    func data(_ name: String) -> Data? {
        if case .blob(let value) = columns[name] { return value }
        return nil
    }
}

final class SQLiteConnection {
    private let handle: OpaquePointer

    init(path: String) throws {
        var db: OpaquePointer?
        let result = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil)
        guard result == SQLITE_OK, let opened = db else {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "code \(result)"
            sqlite3_close(db)
            throw SQLiteError(description: "Couldn't open \(path): \(message)")
        }
        handle = opened
        sqlite3_busy_timeout(opened, 2000)
    }

    deinit {
        sqlite3_close(handle)
    }

    func query(_ sql: String, _ parameters: [SQLiteValue] = []) throws -> [SQLiteRow] {
        var prepared: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &prepared, nil) == SQLITE_OK, let statement = prepared else {
            throw SQLiteError(description: String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        for (offset, parameter) in parameters.enumerated() {
            let index = Int32(offset + 1)
            switch parameter {
            case .int(let value):
                sqlite3_bind_int64(statement, index, value)
            case .text(let value):
                sqlite3_bind_text(statement, index, value, -1, SQLITE_TRANSIENT)
            }
        }
        var rows: [SQLiteRow] = []
        while true {
            let step = sqlite3_step(statement)
            if step == SQLITE_DONE { break }
            guard step == SQLITE_ROW else {
                throw SQLiteError(description: String(cString: sqlite3_errmsg(handle)))
            }
            rows.append(SQLiteRow(statement))
        }
        return rows
    }
}
