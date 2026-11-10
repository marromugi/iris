import Backend
import Foundation
import Testing

@testable import Features

struct RunStatusTests {
    @Test(
        arguments: [
            (nil, nil, RunStatus.running),
            (nil, "The model did not answer in time.", .retrying),
            (Date(timeIntervalSince1970: 0), nil, .finished),
            (Date(timeIntervalSince1970: 0), "The model did not answer in time.", .gaveUp),
        ] as [(Date?, String?, RunStatus)])
    func comesFromWhetherTheRunEndedAndWhetherItsLastAttemptFailed(endedAt: Date?, lastError: String?, status: RunStatus) {
        var run = Samples.weatherRun
        run.endedAt = endedAt
        run.lastError = lastError

        #expect(RunStatus(of: run) == status)
    }
}
