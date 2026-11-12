/// When an events socket that closed or failed is opened again.
enum SocketReopening {
    /// How long to wait before opening the socket again: a second after one that stayed open, and twice as long after
    /// each failure in a row, up to 30 seconds.
    static func delay(afterFailures failures: Int) -> Duration {
        .seconds(min(30, 1 << min(failures, 5)))
    }

    /// How long the socket has to stay open for its end not to count as a failure. A socket that fails to open, or
    /// closes sooner, counts as one.
    static let openLongEnough: Duration = .seconds(10)
}
