import Vapor

actor EventHub {
    private var clients: [UUID: WebSocket] = [:]
    private let encoder: JSONEncoder

    init() {
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
    }

    func add(_ socket: WebSocket) {
        let id = UUID()
        clients[id] = socket
        socket.onClose.whenComplete { [weak self] _ in
            Task { await self?.remove(id) }
        }
    }

    func broadcast(_ event: BridgeEvent) {
        guard let data = try? encoder.encode(event),
              let text = String(data: data, encoding: .utf8) else { return }
        for socket in clients.values {
            socket.eventLoop.execute { socket.send(text) }
        }
    }

    private func remove(_ id: UUID) {
        clients.removeValue(forKey: id)
    }
}
