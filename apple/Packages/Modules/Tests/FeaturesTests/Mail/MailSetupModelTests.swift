import Backend
import Foundation
import Synchronization
import Testing

@testable import Features

struct MailSetupModelTests {
    /// Returns once `condition` holds, giving up after a second.
    func eventually(_ condition: () -> Bool) async {
        for _ in 0..<200 where !condition() {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    @Test(arguments: [
        (MailSetup(), MailStatus.noAddress),
        (FakeMailBackend.waitingSetup, .waiting),
        (FakeMailBackend.confirmationSetup, .confirmationArrived(FakeMailBackend.confirmation)),
        (
            MailSetup(
                address: FakeMailBackend.address, confirmation: FakeMailBackend.confirmation,
                lastMailAt: FakeMailBackend.receivingSetup.lastMailAt),
            .confirmationArrived(FakeMailBackend.confirmation)
        ),
        (FakeMailBackend.receivingSetup, .receiving(lastMailAt: Date(timeIntervalSince1970: 1_794_480_600))),
    ])
    func statusFollowsTheSetup(setup: MailSetup, status: MailStatus) {
        #expect(MailStatus(setup) == status)
    }

    @Test func aConfirmationThatArrivedIsOffered() async {
        let mail = MailSetupModel(backend: FakeMailBackend(.init(setup: .success(FakeMailBackend.confirmationSetup))))

        await mail.load()

        #expect(mail.offer == .confirm(FakeMailBackend.confirmation))
    }

    @Test func aConfirmationPutOffIsNotOfferedAgainByItselfButCanBeAskedFor() async {
        let mail = MailSetupModel(backend: FakeMailBackend(.init(setup: .success(FakeMailBackend.confirmationSetup))))
        await mail.load()

        mail.closeOffer()
        await mail.load()
        let afterReading = mail.offer
        mail.offerConfirmation()

        #expect(afterReading == nil)
        #expect(mail.offer == .confirm(FakeMailBackend.confirmation))
    }

    @Test func openingTheLinkAsksToTurnForwardingOnAndClosingThatLetsGoOfTheConfirmation() async {
        let backend = FakeMailBackend(.init(setup: .success(FakeMailBackend.confirmationSetup)))
        let mail = MailSetupModel(backend: backend)
        await mail.load()

        mail.openedConfirmation()
        await mail.load()
        let duringTheStep = (offer: mail.offer, dismissed: backend.dismissed)
        mail.closeOffer()
        await eventually { backend.dismissed == 1 }

        #expect(duringTheStep.offer == .turnOnForwarding)
        #expect(duringTheStep.dismissed == 0)
        #expect(backend.dismissed == 1)
        #expect(mail.offer == nil)
    }

    @Test func aSecondTapWhileAnAddressIsBeingMadeMakesNoSecond() async {
        let backend = FakeMailBackend()
        let mail = MailSetupModel(backend: backend)
        await mail.load()

        mail.makeAddress()
        mail.makeAddress()
        await eventually { !mail.isChanging }

        #expect(backend.madeAddresses == 1)
        #expect(mail.setup.value == FakeMailBackend.waitingSetup)
    }

    @Test func stoppingLeavesNoAddress() async {
        let backend = FakeMailBackend(.init(setup: .success(FakeMailBackend.receivingSetup)))
        let mail = MailSetupModel(backend: backend)
        await mail.load()

        mail.stop()
        await eventually { !mail.isChanging }

        #expect(backend.stopped == 1)
        #expect(mail.setup.value == MailSetup())
        #expect(mail.problem == nil)
    }

    @Test func aConfirmationThatArrivedDuringTheLastStepIsOfferedOnceItCloses() async {
        let backend = FakeMailBackend(.init(setup: .success(FakeMailBackend.confirmationSetup)))
        let mail = MailSetupModel(backend: backend)
        await mail.load()
        mail.openedConfirmation()
        let second = MailConfirmation(
            url: "https://mail-settings.google.com/mail/vf-second", code: nil,
            receivedAt: Date(timeIntervalSince1970: 1_794_490_000))
        backend.answer { $0.setup = .success(MailSetup(address: FakeMailBackend.address, confirmation: second)) }
        await mail.load()
        let duringTheStep = mail.offer

        mail.closeOffer()

        #expect(duringTheStep == .turnOnForwarding)
        #expect(mail.offer == .confirm(second))
    }

    @Test func signingOutForgetsTheSetup() async {
        let mail = MailSetupModel(backend: FakeMailBackend(.init(setup: .success(FakeMailBackend.confirmationSetup))))
        await mail.load()
        mail.openedConfirmation()

        mail.reset()

        #expect(mail.offer == nil)
        #expect(mail.setup.value == nil)
    }

    @Test func aConfirmationTheServerWouldNotLetGoOfSaysWhyAndIsNotOfferedAgainByItself() async {
        let backend = FakeMailBackend(
            .init(setup: .success(FakeMailBackend.confirmationSetup), dismiss: .failure(.offline)))
        let mail = MailSetupModel(backend: backend)
        await mail.load()

        mail.openedConfirmation()
        mail.closeOffer()
        await eventually { mail.problem != nil }
        await mail.load()

        #expect(mail.problem == .offline)
        #expect(mail.offer == nil)
        #expect(MailStatus(mail.setup.value ?? MailSetup()) == .confirmationArrived(FakeMailBackend.confirmation))
    }

    @Test func aReadThatLeftBeforeANewAddressDoesNotReplaceIt() async {
        let backend = FakeMailBackend(.init(holdsReads: true))
        let mail = MailSetupModel(backend: backend)
        let reading = Task { await mail.load() }
        await eventually { backend.readsWaiting == 1 }

        mail.makeAddress()
        await eventually { !mail.isChanging }
        backend.answer { $0.setup = .failure(.offline) }
        backend.releaseReads()
        await reading.value

        #expect(mail.setup.value == FakeMailBackend.waitingSetup)
    }

    @Test func aSocketThatKeepsFailingIsOpenedAgainLaterEachTime() async {
        let backend = FakeMailBackend(.init(follow: .offline))
        let waits = Mutex<[Duration]>([])
        let mail = MailSetupModel(backend: backend, wait: { delay in
            waits.withLock { $0.append(delay) }
            if waits.withLock({ $0.count }) >= 3 { throw CancellationError() }
        })

        await mail.follow()

        #expect(backend.socketsOpened == 3)
        #expect(waits.withLock { $0 } == [.seconds(2), .seconds(4), .seconds(8)])
    }

    @Test func aChangeThatFailsSaysWhyAndKeepsWhatIsShown() async {
        let backend = FakeMailBackend(.init(makeAddress: .failure(.offline)))
        let mail = MailSetupModel(backend: backend)
        await mail.load()

        mail.makeAddress()
        await eventually { !mail.isChanging }

        #expect(mail.problem == .offline)
        #expect(mail.setup.value == MailSetup())
    }

    @Test func followingOffersAConfirmationThatArrivesWhileTheAppIsOpen() async {
        let backend = FakeMailBackend(.init(setup: .success(FakeMailBackend.waitingSetup)))
        let mail = MailSetupModel(backend: backend)

        let following = Task { await mail.follow() }
        await eventually { mail.setup.value != nil }
        backend.answer { $0.setup = .success(FakeMailBackend.confirmationSetup) }
        backend.send(.case1(.init(_type: .mail)))
        await eventually { mail.offer != nil }
        following.cancel()
        await following.value

        #expect(mail.offer == .confirm(FakeMailBackend.confirmation))
    }

    @Test func followingStopsWhenTheSignInEnds() async {
        let mail = MailSetupModel(backend: FakeMailBackend(.init(follow: .signedOut)))

        await mail.follow()

        guard case .failed(.signedOut) = mail.setup else {
            Issue.record("The setup is \(mail.setup), not a failed sign-in.")
            return
        }
    }
}
