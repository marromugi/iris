import Backend
import Foundation
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

    @Test func openingTheLinkLetsGoOfTheConfirmationAndAsksToTurnForwardingOn() async {
        let backend = FakeMailBackend(.init(setup: .success(FakeMailBackend.confirmationSetup)))
        let mail = MailSetupModel(backend: backend)
        await mail.load()

        mail.openedConfirmation()
        await eventually { backend.dismissed == 1 }
        backend.answer { $0.setup = .success(FakeMailBackend.waitingSetup) }
        await mail.load()

        #expect(backend.dismissed == 1)
        #expect(mail.offer == .turnOnForwarding)
        mail.closeOffer()
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
