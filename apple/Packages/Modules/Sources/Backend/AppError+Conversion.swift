import AuthenticationServices
import Foundation
import OSLog
import OpenAPIRuntime

private let log = Logger(subsystem: "dev.marromugi.iris", category: "backend")

extension AppError {
    /// The kind of an error from below. Logged first, since only the kind is kept.
    init(_ error: any Error) {
        switch error {
        case let error as AppError:
            self = error
        case let error as ClientError:
            self = AppError(error.underlyingError)
        case is CancellationError:
            self = .cancelled
        case let error as URLError where error.code == .cancelled:
            self = .cancelled
        case let error as URLError:
            log.error("Could not reach the server: \(error.localizedDescription)")
            self = .offline
        default:
            log.error("Unexpected error: \(String(describing: error))")
            self = .unexpected
        }
    }

    /// The kind of an error from the sign-in sheet, where closing the sheet is a cancel.
    init(signInSheetError error: any Error) {
        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
            self = .cancelled
        } else {
            self = AppError(error)
        }
    }
}
