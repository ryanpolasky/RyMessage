import Foundation
import ImageIO
import UniformTypeIdentifiers

// browsers can't show HEIC, so iPhone photos are served as cached JPEGs
enum ImageConversion {
    private static var cacheDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Caches/RyMessage/images", isDirectory: true)
    }

    static func jpeg(from source: URL, cacheKey: String) -> Data? {
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
}
