import Backend
import Foundation
import Testing

@testable import Features

struct NewTaskFormTests {
    let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    @Test func sendsTheTrimmedPromptToRunEveryDayAtThePickedTimeInTheCalendarsTimeZone() async {
        let backend = FakeAgentBackend()
        let list = TaskList(backend: backend)
        await list.load()
        let form = NewTaskForm(list: list, calendar: calendar)
        var added = false

        form.prompt = "  天気を教えて\n"
        form.timeOfDay = Samples.moment("2026-11-10T12:05:00Z")
        await form.add { added = true }.value

        #expect(added)
        let sent = try? await backend.tasks().last
        #expect(sent?.prompt == "天気を教えて")
        #expect(sent?.schedule.cron == "5 7 * * *")
        #expect(sent?.schedule.timeZone == "America/New_York")
    }

    @Test(arguments: ["", " \n "])
    func cannotAddAnEmptyPrompt(prompt: String) {
        let form = NewTaskForm(list: TaskList(backend: FakeAgentBackend()), calendar: calendar)

        form.prompt = prompt

        #expect(!form.canAdd)
    }

    @Test func aTaskTheServerRefusesStaysToBeFixedWithTheReason() async {
        let list = TaskList(backend: FakeAgentBackend(.init(failure: .refused(message: "Not a known IANA time zone."))))
        let form = NewTaskForm(list: list, calendar: calendar)
        var added = false

        form.prompt = "天気を教えて"
        await form.add { added = true }.value

        #expect(!added)
        #expect(form.problem == .refused(message: "Not a known IANA time zone."))
        #expect(form.canAdd)
    }
}
