import Backend
import Foundation

/// Where the user's mail setup stands, as the screens tell it.
enum MailStatus: Equatable {
    /// No address yet.
    case noAddress
    /// An address, with no word from Gmail and no mail yet.
    case waiting
    /// Gmail's forwarding confirmation is waiting for the user.
    case confirmationArrived(MailConfirmation)
    /// Mail arrives; the latest at this moment.
    case receiving(lastMailAt: Date)

    init(_ setup: MailSetup) {
        if setup.address == nil {
            self = .noAddress
        } else if let confirmation = setup.confirmation {
            self = .confirmationArrived(confirmation)
        } else if let lastMailAt = setup.lastMailAt {
            self = .receiving(lastMailAt: lastMailAt)
        } else {
            self = .waiting
        }
    }

    /// A few words for a list row.
    var summary: String {
        switch self {
        case .noAddress: "未設定"
        case .waiting: "設定中"
        case .confirmationArrived: "確認待ち"
        case .receiving: "受け取り中"
        }
    }
}
