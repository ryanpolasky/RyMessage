import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

// browsers can't play HEIC photos, HEVC .mov videos, or .caf voice messages, so those are served as cached conversions
enum MediaConversion {
    private static let photoExtensions: Set<String> = ["heic", "heif"]
    private static let videoExtensions: Set<String> = ["mov", "qt", "3gp"]
    private static let audioExtensions: Set<String> = ["caf", "amr"]

    private static var cacheDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Caches/RyMessage/media", isDirectory: true)
    }

    static func servedMimeType(declared: String?, fileName: String) -> String {
        let ext = (fileName as NSString).pathExtension.lowercased()
        if photoExtensions.contains(ext) { return "image/jpeg" }
        if videoExtensions.contains(ext) { return "video/mp4" }
        if audioExtensions.contains(ext) { return "audio/mp4" }
        if let declared, !declared.isEmpty { return declared }
        return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    static func servedData(for source: URL, cacheKey: String) async -> Data? {
        let ext = source.pathExtension.lowercased()
        if photoExtensions.contains(ext) { return jpeg(from: source, cacheKey: cacheKey) }
        if videoExtensions.contains(ext) {
            return await export(source, cacheKey: cacheKey, preset: AVAssetExportPreset1280x720, fileType: .mp4, ext: "mp4")
        }
        if audioExtensions.contains(ext) {
            return await export(source, cacheKey: cacheKey, preset: AVAssetExportPresetAppleM4A, fileType: .m4a, ext: "m4a")
        }
        return try? Data(contentsOf: source)
    }

    private static func jpeg(from source: URL, cacheKey: String) -> Data? {
        let cached = cacheDirectory.appendingPathComponent("\(cacheKey).jpg")
        if let data = try? Data(contentsOf: cached) { return data }
        guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 2048,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary) else {
            return nil
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output as CFMutableData,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { return nil }
        let properties: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.85]
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        let data = output as Data
        try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        try? data.write(to: cached, options: .atomic)
        return data
    }

    private static func export(
        _ source: URL,
        cacheKey: String,
        preset: String,
        fileType: AVFileType,
        ext: String
    ) async -> Data? {
        let cached = cacheDirectory.appendingPathComponent("\(cacheKey).\(ext)")
        if let data = try? Data(contentsOf: cached) { return data }
        guard FileManager.default.fileExists(atPath: source.path),
              let session = AVAssetExportSession(asset: AVURLAsset(url: source), presetName: preset)
        else { return nil }
        try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
        let partial = cacheDirectory.appendingPathComponent("\(cacheKey).partial.\(ext)")
        try? FileManager.default.removeItem(at: partial)
        session.outputURL = partial
        session.outputFileType = fileType
        session.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { continuation in
            session.exportAsynchronously {
                continuation.resume()
            }
        }
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: partial)
            return nil
        }
        try? FileManager.default.moveItem(at: partial, to: cached)
        return try? Data(contentsOf: cached)
    }
}
