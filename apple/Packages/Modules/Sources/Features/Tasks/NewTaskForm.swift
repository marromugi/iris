import Backend
import Foundation
import Observation

/// What the user writes for a new task — a prompt and a time of day — and sending it. The task runs every day at
/// that time in the calendar's time zone.
@Observable
final class NewTaskForm {
    var prompt = ""
    var time = DailyTime(hour: 9, minute: 0)
    private(set) var isAdding = false
    /// Why the last try did not go through.
    private(set) var problem: AppError?

    private let list: TaskList
    private let calendar: Calendar

    init(list: TaskList, calendar: Calendar = .current) {
        self.list = list
        self.calendar = calendar
    }

    /// The time as a date today, for a time picker; setting it keeps only its hour and minute.
    var timeOfDay: Date {
        get { time.date(on: calendar, now: Date()) }
        set { time = DailyTime(of: newValue, on: calendar) }
    }

    /// The time zone the task runs in.
    var timeZone: TimeZone { calendar.timeZone }

    var canAdd: Bool { !isAdding && !trimmedPrompt.isEmpty }

    /// What adding sends.
    var newTask: NewTask {
        NewTask(prompt: trimmedPrompt, schedule: .init(cron: time.cron, timeZone: calendar.timeZone.identifier))
    }

    /// Sends the task, and gives back the work, which calls `onAdded` once the task is in the list. Does nothing while
    /// the prompt is empty or a task is already being sent.
    @discardableResult
    func add(onAdded: @escaping () -> Void) -> Task<Void, Never> {
        guard canAdd else { return Task {} }
        isAdding = true
        problem = nil
        let task = newTask
        return Task {
            do throws(AppError) {
                try await list.add(task)
                onAdded()
            } catch {
                problem = error
                isAdding = false
            }
        }
    }

    private var trimmedPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
}
