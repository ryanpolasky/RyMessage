// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RyMessageServer",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", exact: "4.117.2")
    ],
    targets: [
        .executableTarget(
            name: "RyMessageServer",
            dependencies: [
                .product(name: "Vapor", package: "vapor")
            ],
            linkerSettings: [
                .linkedLibrary("sqlite3"),
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "\(Context.packageDirectory)/Resources/Info.plist",
                ]),
            ]
        )
    ]
)
