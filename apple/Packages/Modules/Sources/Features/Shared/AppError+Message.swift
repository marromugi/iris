import Backend

extension AppError {
    /// What a screen says about the failure, or nothing for one the user caused on purpose.
    var message: String? {
        switch self {
        case .signedOut: "サインインが切れました。もう一度サインインしてください。"
        case .offline: "サーバーにつながりません。電波を確かめて、もう一度試してください。"
        case .refused(let message): "サーバーがこう返しました：\(message)"
        case .unexpected: "うまくいきませんでした。もう一度試してください。"
        case .cancelled: nil
        }
    }
}
