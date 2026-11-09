import Backend
import Foundation

/// Which iris server the app talks to.
public enum ServerOrigin {
    /// Production; in a debug build, the origin in `IRIS_SERVER_ORIGIN` when it is set, to run against a local server.
    public static var current: URL {
        #if DEBUG
            if let value = ProcessInfo.processInfo.environment["IRIS_SERVER_ORIGIN"], let url = URL(string: value) {
                return url
            }
        #endif
        return IrisBackend.production
    }
}
