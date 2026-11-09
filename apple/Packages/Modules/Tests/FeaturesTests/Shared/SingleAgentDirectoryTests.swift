import Backend
import Foundation
import Testing

@testable import Features

struct SingleAgentDirectoryTests {
    @Test func listsTheOneAgentWithWhenItsLatestRunStarted() async throws {
        let directory = SingleAgentDirectory(backend: FakeAgentBackend())

        let agents = try await directory.agents()

        #expect(agents.map(\.lastRanAt) == [Samples.moment("2026-11-10T00:00:00Z")])
    }

    @Test func anAgentThatHasNotRunHasNoTime() async throws {
        let directory = SingleAgentDirectory(backend: FakeAgentBackend(.init(runs: [])))

        let agents = try await directory.agents()

        #expect(agents.map(\.lastRanAt) == [nil])
    }
}
