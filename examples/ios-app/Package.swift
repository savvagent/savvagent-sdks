// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SavvagentExample",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "SavvagentExample",
            targets: ["SavvagentExample"]),
    ],
    dependencies: [
        .package(path: "../../packages/ios-sdk")
    ],
    targets: [
        .target(
            name: "SavvagentExample",
            dependencies: [
                .product(name: "SavvagentSDK", package: "ios-sdk")
            ]
        )
    ]
)
