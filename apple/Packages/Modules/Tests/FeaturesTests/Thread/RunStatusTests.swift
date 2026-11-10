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

    @Test(
        arguments: [
            (nil, RunProgress.case1(.init(_type: .starting)), RunStatus.starting),
            (nil, Samples.thinking, .thinking),
            ("The model did not answer in time.", Samples.writing("Hel"), .writing),
        ] as [(String?, RunProgress, RunStatus)])
    func comesFromHowTheRunIsGettingOnWhileItIsCarriedOnAgain(
        lastError: String?, progress: RunProgress, status: RunStatus
    ) {
        var run = Samples.weatherRun
        run.endedAt = nil
        run.lastError = lastError

        #expect(RunStatus(of: run, progress: progress) == status)
    }

    @Test func anEndedRunIsFinishedWhateverProgressWasLastHeard() {
        #expect(RunStatus(of: Samples.weatherRun, progress: Samples.writing("Hel")) == .finished)
    }
}
