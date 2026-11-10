import Backend

@testable import Features

extension Loadable {
    var failure: AppError? {
        if case .failed(let error) = self { error } else { nil }
    }
}
