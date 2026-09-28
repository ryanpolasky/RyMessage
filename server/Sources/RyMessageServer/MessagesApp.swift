import Foundation

struct AppleScriptError: Error, CustomStringConvertible {
    let description: String
}

enum MessagesApp {
    static func send(text: String, chatGuid: String, fallbackHandle: String?) async throws {
        try await run([
            "on run argv",
            "set theText to item 2 of argv",
            "set chatGuid to item 3 of argv",
            "set theHandle to item 4 of argv",
            "tell application \"Messages\"",
            "try",
            "send theText to chat id chatGuid",
            "return",
            "end try",
            "if theHandle is \"\" then error \"Messages couldn't find this conversation.\"",
            "send theText to participant theHandle of (1st account whose service type = iMessage)",
            "end tell",
            "end run",
        ], arguments: [text, chatGuid, fallbackHandle ?? ""])
    }

    static func send(text: String, toHandle handle: String) async throws {
        try await run([
            "on run argv",
            "tell application \"Messages\"",
            "send (item 2 of argv) to participant (item 3 of argv) of (1st account whose service type = iMessage)",
            "end tell",
            "end run",
        ], arguments: [text, handle])
    }

    static func send(file: URL, chatGuid: String) async throws {
        try await run([
            "on run argv",
            "set theFile to POSIX file (item 2 of argv)",
            "tell application \"Messages\" to send theFile to chat id (item 3 of argv)",
            "end run",
        ], arguments: [file.path, chatGuid])
    }

    static func checkAccess() async throws {
        try await run(["tell application \"Messages\" to get name"], arguments: [])
    }

    // the leading placeholder keeps osascript from reading a message that starts with "-" as a flag
    @discardableResult
    private static func run(_ lines: [String], arguments: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = lines.flatMap { ["-e", $0] } + ["rymessage"] + arguments
            let output = Pipe()
            let errors = Pipe()
            process.standardOutput = output
            process.standardError = errors
            process.terminationHandler = { finished in
                let out = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                let err = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                if finished.terminationStatus == 0 {
                    continuation.resume(returning: out.trimmingCharacters(in: .whitespacesAndNewlines))
                } else {
                    continuation.resume(throwing: AppleScriptError(description: err.trimmingCharacters(in: .whitespacesAndNewlines)))
                }
            }
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
