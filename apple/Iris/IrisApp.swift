import Features
import SwiftUI

@main
struct IrisApp: App {
    var body: some Scene {
        WindowGroup {
            IrisRoot(origin: ServerOrigin.current)
        }
    }
}
