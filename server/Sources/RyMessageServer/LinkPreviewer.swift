import Darwin
import Foundation

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

actor LinkPreviewer {
    private static let maxRedirects = 5
    private static let maxHTMLBytes = 262_144
    private static let maxCacheEntries = 500
    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"

    private let session: URLSession
    private var cache: [String: LinkPreview] = [:]

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 6
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        session = URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }

    func preview(for rawURL: String) async throws -> LinkPreview {
        let initial = try Self.parseHTTPURL(rawURL)
        let key = initial.absoluteString
        if let cached = cache[key] {
            return cached
        }
        guard Self.resolvesToPublicAddress(initial) else {
            throw ApiError.invalidRequest("That link doesn't point to a public address.")
        }

        let result: LinkPreview
        if let oembed = await tryOEmbed(for: initial) {
            result = oembed
        } else {
            result = try await fetchHTMLPreview(from: initial)
        }

        if cache.count >= Self.maxCacheEntries {
            cache.removeAll(keepingCapacity: true)
        }
        cache[key] = result
        return result
    }

    private struct OEmbedPayload: Decodable {
        var title: String?
        var author_name: String?
        var provider_name: String?
        var thumbnail_url: String?
        var html: String?
    }

    private func tryOEmbed(for target: URL) async -> LinkPreview? {
        guard let endpoint = Self.oembedEndpoint(for: target) else { return nil }
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 4
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let payload = try? JSONDecoder().decode(OEmbedPayload.self, from: data)
        else { return nil }

        let snippet = payload.html.flatMap(Self.extractParagraph)
        let author = Self.cleanText(payload.author_name)
        let title = Self.cleanText(payload.title) ?? author
        let description = (title == author) ? snippet : (snippet ?? author)
        if title == nil && payload.thumbnail_url == nil && description == nil {
            return nil
        }
        return LinkPreview(
            url: target.absoluteString,
            title: title,
            description: description,
            siteName: Self.cleanText(payload.provider_name),
            image: Self.sanitizeAssetURL(payload.thumbnail_url, relativeTo: target),
            icon: nil
        )
    }

    private func fetchHTMLPreview(from start: URL) async throws -> LinkPreview {
        var current = start
        var finalBytes: URLSession.AsyncBytes?
        var finalResponse: HTTPURLResponse?

        for _ in 0...Self.maxRedirects {
            var request = URLRequest(url: current)
            request.setValue("text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", forHTTPHeaderField: "Accept")
            request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
            request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")

            let (bytes, response): (URLSession.AsyncBytes, URLResponse)
            do {
                (bytes, response) = try await session.bytes(for: request)
            } catch {
                throw ApiError.notFound("Couldn't load a preview for that link.")
            }
            guard let http = response as? HTTPURLResponse else {
                throw ApiError.notFound("Couldn't load a preview for that link.")
            }
            if (300..<400).contains(http.statusCode) {
                guard let location = http.value(forHTTPHeaderField: "Location"),
                      let next = URL(string: location, relativeTo: current)?.absoluteURL,
                      (next.scheme == "http" || next.scheme == "https"),
                      Self.resolvesToPublicAddress(next)
                else {
                    throw ApiError.notFound("Couldn't follow that link redirect.")
                }
                current = next
                continue
            }
            finalBytes = bytes
            finalResponse = http
            break
        }

        guard let bytes = finalBytes, let http = finalResponse, (200..<300).contains(http.statusCode) else {
            throw ApiError.notFound("Couldn't load a preview for that link.")
        }

        let mime = http.mimeType?.lowercased() ?? ""
        if !mime.contains("html") && !mime.contains("xhtml") {
            return LinkPreview(url: current.absoluteString, title: nil, description: nil, siteName: nil, image: nil, icon: nil)
        }

        var buffer = Data()
        buffer.reserveCapacity(32_768)
        let headClose = Array("</head>".utf8)
        do {
            for try await byte in bytes {
                buffer.append(byte)
                if buffer.count >= Self.maxHTMLBytes { break }
                if buffer.count >= headClose.count, Self.endsWithHeadClose(buffer) { break }
            }
        } catch {
            if buffer.isEmpty {
                throw ApiError.notFound("Couldn't load a preview for that link.")
            }
        }

        let html = String(decoding: buffer, as: UTF8.self)
        return Self.parseHTML(html, baseURL: current)
    }

    private static func endsWithHeadClose(_ data: Data) -> Bool {
        guard data.count >= 7 else { return false }
        let tail = data.suffix(7)
        return String(decoding: tail, as: UTF8.self).lowercased() == "</head>"
    }

    private static func parseHTTPURL(_ raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              url.host != nil
        else {
            throw ApiError.invalidRequest("A valid http or https URL is required.")
        }
        return url
    }

    private static func isDisallowedHostname(_ host: String) -> Bool {
        var lower = host.lowercased()
        while lower.hasSuffix(".") { lower.removeLast() }
        return lower.isEmpty
            || lower == "localhost"
            || lower.hasSuffix(".localhost")
            || lower.hasSuffix(".local")
            || lower.hasSuffix(".internal")
    }

    private static func isPublicIPv4(_ bytes: (UInt8, UInt8, UInt8, UInt8)) -> Bool {
        let (a, b, c, _) = bytes
        if a == 0 || a == 10 || a == 127 || a >= 224 { return false }
        if a == 169 && b == 254 { return false }
        if a == 172 && (16...31).contains(b) { return false }
        if a == 192 && b == 168 { return false }
        if a == 100 && (b & 0b1100_0000) == 64 { return false }
        if a == 192 && b == 0 && (c == 0 || c == 2) { return false }
        if a == 198 && (b == 18 || b == 19) { return false }
        if a == 198 && b == 51 && c == 100 { return false }
        if a == 203 && b == 0 && c == 113 { return false }
        return true
    }

    private static func isPublicIPv6(_ octets: [UInt8]) -> Bool {
        guard octets.count == 16 else { return false }
        let allZeroPrefix = octets[0..<10].allSatisfy { $0 == 0 }
        if allZeroPrefix && octets[10] == 0xff && octets[11] == 0xff {
            return isPublicIPv4((octets[12], octets[13], octets[14], octets[15]))
        }
        if octets.allSatisfy({ $0 == 0 }) { return false }
        if octets[0..<15].allSatisfy({ $0 == 0 }) && octets[15] == 1 { return false }
        if octets[0] == 0xff { return false }
        if (octets[0] & 0xfe) == 0xfc { return false }
        if octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80 { return false }
        return true
    }

    private static func resolvesToPublicAddress(_ url: URL) -> Bool {
        guard let rawHost = url.host, !isDisallowedHostname(rawHost) else { return false }
        let host = rawHost.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        var hints = addrinfo()
        hints.ai_socktype = SOCK_STREAM
        var infoPointer: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &infoPointer) == 0, let first = infoPointer else {
            return false
        }
        defer { freeaddrinfo(first) }

        var count = 0
        var cursor: UnsafeMutablePointer<addrinfo>? = first
        while let entry = cursor {
            defer { cursor = entry.pointee.ai_next }
            guard let addr = entry.pointee.ai_addr else { continue }
            switch Int32(addr.pointee.sa_family) {
            case AF_INET:
                let ipv4 = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                    UInt32(bigEndian: $0.pointee.sin_addr.s_addr)
                }
                let octets = (
                    UInt8((ipv4 >> 24) & 0xff),
                    UInt8((ipv4 >> 16) & 0xff),
                    UInt8((ipv4 >> 8) & 0xff),
                    UInt8(ipv4 & 0xff)
                )
                if !isPublicIPv4(octets) { return false }
                count += 1
            case AF_INET6:
                let octets = addr.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { ptr in
                    withUnsafeBytes(of: ptr.pointee.sin6_addr) { Array($0) }
                }
                if !isPublicIPv6(octets) { return false }
                count += 1
            default:
                continue
            }
        }
        return count > 0
    }

    private static func sanitizeAssetURL(_ raw: String?, relativeTo base: URL) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty,
              let resolved = URL(string: trimmed, relativeTo: base)?.absoluteURL,
              let scheme = resolved.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              let host = resolved.host,
              !isDisallowedHostname(host)
        else { return nil }
        return resolved.absoluteString
    }

    private static func oembedEndpoint(for url: URL) -> URL? {
        guard var host = url.host?.lowercased() else { return nil }
        if host.hasPrefix("www.") { host.removeFirst(4) }
        if host.hasPrefix("m.") { host.removeFirst(2) }

        let base: String
        var extra: [URLQueryItem] = []
        if host == "youtube.com" || host == "youtu.be" {
            base = "https://www.youtube.com/oembed"
        } else if host == "open.spotify.com" {
            base = "https://open.spotify.com/oembed"
        } else if host == "vimeo.com" {
            base = "https://vimeo.com/api/oembed.json"
        } else if (host == "x.com" || host == "twitter.com") && url.path.contains("/status/") {
            base = "https://publish.twitter.com/oembed"
            extra.append(URLQueryItem(name: "omit_script", value: "true"))
        } else {
            return nil
        }

        var components = URLComponents(string: base)
        components?.queryItems = [
            URLQueryItem(name: "url", value: url.absoluteString),
            URLQueryItem(name: "format", value: "json"),
        ] + extra
        return components?.url
    }

    private static func parseHTML(_ html: String, baseURL: URL) -> LinkPreview {
        var meta: [String: String] = [:]
        var touchIcon: String?
        var icon: String?
        var titleTag: String?

        var index = html.startIndex
        while index < html.endIndex, let open = html[index...].firstIndex(of: "<") {
            if html[open...].hasPrefix("<!--") {
                let searchFrom = html.index(open, offsetBy: 4, limitedBy: html.endIndex) ?? html.endIndex
                if let commentEnd = html.range(of: "-->", range: searchFrom..<html.endIndex) {
                    index = commentEnd.upperBound
                    continue
                }
                break
            }
            let afterOpen = html.index(after: open)
            guard let close = findTagEnd(in: html, from: afterOpen) else { break }
            let rawTag = html[afterOpen..<close].trimmingCharacters(in: .whitespacesAndNewlines)
            index = html.index(after: close)

            if rawTag.isEmpty || rawTag.hasPrefix("/") || rawTag.hasPrefix("!") || rawTag.hasPrefix("?") {
                if rawTag.lowercased() == "/head" { break }
                continue
            }

            let splitIndex = rawTag.firstIndex(where: { $0.isWhitespace || $0 == "/" }) ?? rawTag.endIndex
            let tagName = rawTag[..<splitIndex].lowercased()
            let attrSlice = String(rawTag[splitIndex...])

            if tagName == "title" && titleTag == nil {
                if let closeTitle = html.range(of: "</title>", options: .caseInsensitive, range: index..<html.endIndex) {
                    titleTag = cleanText(String(html[index..<closeTitle.lowerBound]))
                    index = closeTitle.upperBound
                }
            } else if tagName == "meta" {
                let attrs = parseAttributes(attrSlice)
                let key = (attrs["property"] ?? attrs["name"])?.lowercased()
                if let key, meta[key] == nil, let value = cleanText(attrs["content"]) {
                    meta[key] = value
                }
            } else if tagName == "link" {
                let attrs = parseAttributes(attrSlice)
                let rel = attrs["rel"]?.lowercased() ?? ""
                if let href = attrs["href"] {
                    if rel.contains("apple-touch-icon") && touchIcon == nil {
                        touchIcon = href
                    } else if rel.split(whereSeparator: \.isWhitespace).contains("icon") && icon == nil {
                        icon = href
                    }
                }
            }
        }

        let title = meta["og:title"] ?? meta["twitter:title"] ?? titleTag
        let description = meta["og:description"] ?? meta["twitter:description"] ?? meta["description"]
        let siteName = meta["og:site_name"] ?? meta["application-name"]
        let rawImage = meta["og:image:secure_url"]
            ?? meta["og:image"]
            ?? meta["og:image:url"]
            ?? meta["twitter:image"]
            ?? meta["twitter:image:src"]

        return LinkPreview(
            url: baseURL.absoluteString,
            title: title,
            description: description,
            siteName: siteName,
            image: sanitizeAssetURL(rawImage, relativeTo: baseURL),
            icon: sanitizeAssetURL(touchIcon ?? icon, relativeTo: baseURL)
        )
    }

    private static func findTagEnd(in text: String, from start: String.Index) -> String.Index? {
        var quote: Character?
        var i = start
        while i < text.endIndex {
            let ch = text[i]
            if let q = quote {
                if ch == q { quote = nil }
            } else if ch == "\"" || ch == "'" {
                quote = ch
            } else if ch == ">" {
                return i
            }
            i = text.index(after: i)
        }
        return nil
    }

    private static func parseAttributes(_ raw: String) -> [String: String] {
        var result: [String: String] = [:]
        var i = raw.startIndex
        while i < raw.endIndex {
            while i < raw.endIndex && (raw[i].isWhitespace || raw[i] == "/") {
                i = raw.index(after: i)
            }
            let keyStart = i
            while i < raw.endIndex && !raw[i].isWhitespace && raw[i] != "=" && raw[i] != "/" {
                i = raw.index(after: i)
            }
            if i == keyStart { break }
            let key = raw[keyStart..<i].lowercased()
            while i < raw.endIndex && raw[i].isWhitespace { i = raw.index(after: i) }
            guard i < raw.endIndex, raw[i] == "=" else { continue }
            i = raw.index(after: i)
            while i < raw.endIndex && raw[i].isWhitespace { i = raw.index(after: i) }
            guard i < raw.endIndex else { break }

            let value: String
            if raw[i] == "\"" || raw[i] == "'" {
                let q = raw[i]
                i = raw.index(after: i)
                let valStart = i
                while i < raw.endIndex && raw[i] != q { i = raw.index(after: i) }
                value = String(raw[valStart..<i])
                if i < raw.endIndex { i = raw.index(after: i) }
            } else {
                let valStart = i
                while i < raw.endIndex && !raw[i].isWhitespace && raw[i] != ">" {
                    i = raw.index(after: i)
                }
                value = String(raw[valStart..<i])
            }
            if result[key] == nil {
                result[key] = decodeEntities(value)
            }
        }
        return result
    }

    private static func extractParagraph(_ html: String) -> String? {
        guard let openP = html.range(of: "<p", options: .caseInsensitive),
              let tagClose = html[openP.lowerBound...].firstIndex(of: ">"),
              let afterOpen = html.index(tagClose, offsetBy: 1, limitedBy: html.endIndex),
              let closeP = html.range(of: "</p>", options: .caseInsensitive, range: afterOpen..<html.endIndex)
        else { return nil }
        return cleanText(stripTags(String(html[afterOpen..<closeP.lowerBound])))
    }

    private static func stripTags(_ html: String) -> String {
        var out = ""
        var inTag = false
        var tag = ""
        for ch in html {
            if ch == "<" {
                inTag = true
                tag.removeAll(keepingCapacity: true)
            } else if ch == ">" && inTag {
                inTag = false
                let lower = tag.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if lower == "br" || lower == "br/" || lower == "br /" {
                    out.append(" ")
                }
            } else if inTag {
                tag.append(ch)
            } else {
                out.append(ch)
            }
        }
        return out
    }

    private static func cleanText(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let decoded = decodeEntities(raw)
        let collapsed = decoded.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return collapsed.isEmpty ? nil : collapsed
    }

    private static func decodeEntities(_ input: String) -> String {
        guard input.contains("&") else { return input }
        var out = ""
        var index = input.startIndex
        while index < input.endIndex {
            guard let amp = input[index...].firstIndex(of: "&") else {
                out.append(contentsOf: input[index...])
                break
            }
            out.append(contentsOf: input[index..<amp])
            let afterAmp = input.index(after: amp)
            let searchEnd = input.index(afterAmp, offsetBy: 12, limitedBy: input.endIndex) ?? input.endIndex
            if let semi = input[afterAmp..<searchEnd].firstIndex(of: ";") {
                let entity = String(input[afterAmp..<semi])
                if let resolved = resolveEntity(entity) {
                    out.append(resolved)
                    index = input.index(after: semi)
                    continue
                }
            }
            out.append("&")
            index = afterAmp
        }
        return out
    }

    private static func resolveEntity(_ entity: String) -> String? {
        if entity.hasPrefix("#x") || entity.hasPrefix("#X") {
            guard let scalar = UInt32(entity.dropFirst(2), radix: 16).flatMap(UnicodeScalar.init) else { return nil }
            return String(scalar)
        }
        if entity.hasPrefix("#") {
            guard let scalar = UInt32(entity.dropFirst()).flatMap(UnicodeScalar.init) else { return nil }
            return String(scalar)
        }
        switch entity {
        case "amp": return "&"
        case "lt": return "<"
        case "gt": return ">"
        case "quot": return "\""
        case "apos": return "'"
        case "nbsp": return " "
        case "middot": return "·"
        case "bull": return "•"
        case "hellip": return "..."
        case "rsquo", "lsquo": return "'"
        case "rdquo", "ldquo": return "\""
        case "ndash", "mdash": return "-"
        case "copy": return "(c)"
        default: return nil
        }
    }
}
