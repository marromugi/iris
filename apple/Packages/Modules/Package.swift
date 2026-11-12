// swift-tools-version: 6.2
import PackageDescription

let concurrency: [SwiftSetting] = [.enableUpcomingFeature("NonisolatedNonsendingByDefault")]
let mainActor: [SwiftSetting] = concurrency + [.defaultIsolation(MainActor.self)]

let package = Package(
    name: "Modules",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "Features", targets: ["Features"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.14.2"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.13.3"),
        .package(url: "https://github.com/apple/swift-http-types", exact: "1.8.0"),
    ],
    targets: [
        // The client generated from apps/agent/openapi.json, and the one entrance the app reaches the server through.
        // Generated code is nonisolated, so this module keeps the package default.
        .target(
            name: "Backend",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "HTTPTypesFoundation", package: "swift-http-types"),
            ],
            swiftSettings: concurrency,
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        ),
        .target(
            name: "Features", dependencies: ["Backend"], resources: [.process("Resources/Fonts")],
            swiftSettings: mainActor),
        .testTarget(name: "BackendTests", dependencies: ["Backend"], swiftSettings: concurrency),
        .testTarget(name: "FeaturesTests", dependencies: ["Features", "Backend"], swiftSettings: mainActor),
    ]
)
