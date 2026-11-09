#!/bin/sh
# Lints the Swift of the app and its modules. Test folders are left out: swift-format's force-unwrap rules skip
# XCTest files but not Swift Testing ones.
set -eu
cd "$(dirname "$0")/.."
swift format lint --strict --recursive Iris Packages/Modules/Package.swift Packages/Modules/Sources
