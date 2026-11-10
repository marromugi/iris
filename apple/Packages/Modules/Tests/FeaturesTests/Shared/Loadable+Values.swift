import Backend

@testable import Features

extension Loadable {
    var value: Value? {
        if case .loaded(let value) = self { value } else { nil }
    }

    var failure: AppError? {
        if case .failed(let error) = self { error } else { nil }
    }
}
