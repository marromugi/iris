import Backend
import Testing

@testable import Features

struct NewAgentFormTests {
    @Test func sendsTheTrimmedNameAndHandsBackTheAgent() async {
        let form = NewAgentForm(directory: FakeAgentDirectory())
        var added: Agent?

        form.name = "  株価の確認\n"
        await form.add(onAdded: { added = $0 }, onSignedOut: {}).value

        #expect(added?.name == "株価の確認")
        #expect(added?.lastRanAt == nil)
    }

    @Test func sendsTheLookItWasShuffledTo() async {
        let form = NewAgentForm(directory: FakeAgentDirectory(), look: AgentLook(palette: 0, seed: 0))
        var added: Agent?

        form.shuffle()
        let shuffled = form.look
        form.name = "株価の確認"
        await form.add(onAdded: { added = $0 }, onSignedOut: {}).value

        #expect(added?.look == shuffled)
        #expect((0..<OrbPalette.all.count).contains(shuffled.palette))
    }

    @Test(arguments: ["", " \n ", String(repeating: "あ", count: 41)])
    func cannotAddABlankOrLongName(name: String) {
        let form = NewAgentForm(directory: FakeAgentDirectory())

        form.name = name

        #expect(!form.canAdd)
    }

    @Test func aNameTheServerRefusesStaysToBeFixedWithTheReason() async {
        let form = NewAgentForm(directory: FakeAgentDirectory(failure: .refused(message: "Too long.")))
        var added = false

        form.name = "株価の確認"
        await form.add(onAdded: { _ in added = true }, onSignedOut: {}).value

        #expect(!added)
        #expect(form.problem == .refused(message: "Too long."))
        #expect(form.canAdd)
    }

    @Test func aRefusedSignInIsHandedOnInsteadOfShownInTheForm() async {
        let form = NewAgentForm(directory: FakeAgentDirectory(failure: .signedOut))
        var signedOut = false

        form.name = "株価の確認"
        await form.add(onAdded: { _ in }, onSignedOut: { signedOut = true }).value

        #expect(signedOut)
        #expect(form.problem == nil)
        #expect(!form.isAdding)
    }
}
