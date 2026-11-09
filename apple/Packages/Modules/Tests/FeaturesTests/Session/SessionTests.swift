import Backend
import Foundation
import Testing

@testable import Features

struct SessionTests {
    let neverOpened: Authenticate = { url, _ in url }

    @Test func startsSignedOutWithoutAKeptSignIn() async {
        let session = Session(backend: FakeSessionBackend())

        await session.start()

        #expect(session.state == .signedOut)
    }

    @Test func startsSignedInWithAKeptSignIn() async {
        let session = Session(backend: FakeSessionBackend(.init(isSignedIn: true)))

        await session.start()

        #expect(session.state == .signedIn)
    }

    @Test func signsIn() async {
        let session = Session(backend: FakeSessionBackend())
        await session.start()

        await session.signIn(authenticate: neverOpened).value

        #expect(session.state == .signedIn)
        #expect(session.problem == nil)
    }

    @Test func closingTheSheetGoesBackWithNothingToSay() async {
        let session = Session(backend: FakeSessionBackend(.init(signIn: .failure(.cancelled))))
        await session.start()

        await session.signIn(authenticate: neverOpened).value

        #expect(session.state == .signedOut)
        #expect(session.problem == nil)
    }

    @Test func aFailedSignInSaysWhy() async {
        let session = Session(backend: FakeSessionBackend(.init(signIn: .failure(.offline))))
        await session.start()

        await session.signIn(authenticate: neverOpened).value

        #expect(session.state == .signedOut)
        #expect(session.problem == .offline)
    }

    @Test func signsOut() async {
        let backend = FakeSessionBackend(.init(isSignedIn: true))
        let session = Session(backend: backend)
        await session.start()

        await session.signOut()

        #expect(session.state == .signedOut)
    }
}
