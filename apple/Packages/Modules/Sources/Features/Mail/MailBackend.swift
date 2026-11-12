import Backend

/// What the mail setup needs from the server, so it can be shown and tested with a fake.
nonisolated protocol MailBackend: Sendable {
    func mailSetup() async throws(AppError) -> MailSetup
    func makeMailAddress() async throws(AppError) -> MailSetup
    func stopMail() async throws(AppError)
    func dismissMailConfirmation() async throws(AppError)
    func followUserEvents(
        onOpen: @Sendable () async -> Void,
        onEvent: @Sendable (UserEvent) async -> Void
    ) async throws(AppError)
}

extension IrisBackend: MailBackend {}
