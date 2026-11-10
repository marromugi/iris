import Backend
import Testing

@testable import Features

struct NewAgentFormTests {
    @Test func sendsTheTrimmedNameAndHandsBackTheAgent() async {
        let form = NewAgentForm(directory: FakeAgentDirectory())
        var added: Agent?

        form.name = "  株価の確認\n"
        await form.add { added = $0 }.value

        #expect(added?.name == "株価の確認")
        #expect(added?.lastRanAt == nil)
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
        await form.add { _ in added = true }.value

        #expect(!added)
        #expect(form.problem == .refused(message: "Too long."))
        #expect(form.canAdd)
    }
}
