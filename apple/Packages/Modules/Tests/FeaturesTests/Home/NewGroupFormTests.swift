import Backend
import Testing

@testable import Features

struct NewGroupFormTests {
    let agents = Array(Samples.agents.prefix(3))

    @Test func sendsTheTrimmedNameAndTheChosenAgentsInTheOrderTheyAreOffered() async {
        let form = NewGroupForm(directory: FakeAgentDirectory(), agents: agents)
        var added: ChatThread?

        form.name = " 朝のチーム "
        form.members = [agents[2].id, agents[0].id]
        await form.add(onAdded: { added = $0 }, onSignedOut: {}).value

        #expect(added?.name == "朝のチーム")
        #expect(added?.agentIds == [agents[0].id, agents[2].id])
        #expect(added?.agentId == nil)
    }

    @Test func needsANameAndTwoOrMoreAgents() {
        let form = NewGroupForm(directory: FakeAgentDirectory(), agents: agents)

        form.name = "朝のチーム"
        form.members = [agents[0].id]
        let withOne = form.canAdd
        form.members.insert(agents[1].id)
        let withTwo = form.canAdd
        form.name = "  "

        #expect(!withOne)
        #expect(withTwo)
        #expect(!form.canAdd)
    }

    @Test func aGroupTheServerRefusesStaysToBeFixedWithTheReason() async {
        let form = NewGroupForm(
            directory: FakeAgentDirectory(failure: .refused(message: "The user has no agent x")), agents: agents)
        var added = false

        form.name = "朝のチーム"
        form.members = [agents[0].id, agents[1].id]
        await form.add(onAdded: { _ in added = true }, onSignedOut: {}).value

        #expect(!added)
        #expect(form.problem == .refused(message: "The user has no agent x"))
        #expect(form.canAdd)
    }

    @Test func aRefusedSignInIsHandedOnInsteadOfShownInTheForm() async {
        let form = NewGroupForm(directory: FakeAgentDirectory(failure: .signedOut), agents: agents)
        var signedOut = false

        form.name = "朝のチーム"
        form.members = [agents[0].id, agents[1].id]
        await form.add(onAdded: { _ in }, onSignedOut: { signedOut = true }).value

        #expect(signedOut)
        #expect(form.problem == nil)
    }
}
