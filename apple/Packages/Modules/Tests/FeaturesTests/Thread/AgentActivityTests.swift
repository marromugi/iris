import Backend
import Testing

@testable import Features

struct AgentActivityTests {
    @Test func deactivatingAndActivatingSwitchTheAgentAndSayItSwitched() async {
        let backend = FakeAgentBackend()
        var switched: [Bool] = []
        let activity = AgentActivity(backend: backend, isActive: true) { switched.append($0) }

        await activity.deactivate().value
        let afterDeactivating = (activity.isActive, backend.active)
        await activity.activate().value

        #expect(afterDeactivating == (false, false))
        #expect((activity.isActive, backend.active) == (true, true))
        #expect(switched == [false, true])
    }

    @Test func aSwitchTheServerRefusesLeavesTheAgentAsItWasAndSaysWhy() async {
        let backend = FakeAgentBackend(.init(failure: .offline))
        var switched: [Bool] = []
        let activity = AgentActivity(backend: backend, isActive: true) { switched.append($0) }

        await activity.deactivate().value

        #expect(activity.isActive)
        #expect(activity.problem == .offline)
        #expect(!activity.isSwitching)
        #expect(switched.isEmpty)
    }
}
