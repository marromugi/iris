#if DEBUG
    import Backend
    import Foundation

    /// Made-up tasks and runs, for previews and tests. Runs are written as `/api` sends them.
    nonisolated enum Samples {
        static let weatherTask = ScheduledTask(
            id: "0b4f6a52-9a51-4c7e-8a9e-6d1f2c3b4a50",
            prompt: "今日の東京の天気を調べて、傘が要るかを一言で教えて。",
            schedule: .init(cron: "0 7 * * *", timeZone: "Asia/Tokyo"),
            nextRunAt: moment("2026-11-10T22:00:00Z")
        )

        static let newsTask = ScheduledTask(
            id: "3c9d1e7a-5b2f-4e8c-9a1d-7f6e5d4c3b2a",
            prompt: "平日の昼に、気になるニュースを 3 つ選んで短くまとめて。",
            schedule: .init(cron: "0 12 * * 1-5", timeZone: "America/Los_Angeles"),
            nextRunAt: moment("2026-11-10T20:00:00Z")
        )

        static let weatherRun = run(
            """
            {
              "id": "8e2a4c6b-1d3f-4a5b-9c7d-2e4f6a8b0c1d",
              "taskId": "\(weatherTask.id)",
              "startedAt": "2026-11-09T22:00:00Z",
              "endedAt": "2026-11-09T22:00:07Z",
              "lastError": null,
              "failedAttempts": 0,
              "messages": [
                {"role": "user", "text": "\(weatherTask.prompt)"},
                {"role": "assistant", "parts": [
                  {"type": "text", "text": "天気予報を調べます。"},
                  {"type": "tool-call", "id": "call-1", "name": "weather", "input": {"city": "Tokyo", "day": "today"}}
                ]},
                {"role": "tool", "callId": "call-1", "isError": false, "content": "{\\"rain\\": 0.7, \\"high\\": 16}"},
                {"role": "assistant", "parts": [
                  {"type": "text", "text": "午後から雨の見込みです。傘を持っていきましょう。"}
                ]}
              ]
            }
            """)

        static let retryingRun = run(
            """
            {
              "id": "5a7b9c1d-3e5f-4a6b-8c0d-2e4f6a8b0c1e",
              "taskId": "\(newsTask.id)",
              "startedAt": "2026-11-09T20:00:00Z",
              "endedAt": null,
              "lastError": "The model did not answer in time.",
              "failedAttempts": 1,
              "messages": [
                {"role": "user", "text": "\(newsTask.prompt)"}
              ]
            }
            """)

        static let gaveUpRun = run(
            """
            {
              "id": "7d3c1f0e-2b4a-4c8e-9f6d-1a2b3c4d5e6f",
              "taskId": null,
              "startedAt": "2026-11-08T20:00:00Z",
              "endedAt": "2026-11-08T20:20:00Z",
              "lastError": "The model did not answer in time.",
              "failedAttempts": 3,
              "messages": [
                {"role": "user", "text": "今週の予定を確かめて、空いている夜を教えて。"},
                {"role": "assistant", "parts": [
                  {"type": "tool-call", "id": "call-1", "name": "calendar", "input": {"week": "2026-W46"}}
                ]},
                {"role": "tool", "callId": "call-1", "isError": true, "content": "The calendar could not be reached."}
              ]
            }
            """)

        static func moment(_ text: String) -> Date {
            guard let date = try? Date(text, strategy: .iso8601) else {
                preconditionFailure("\(text) is an ISO 8601 moment written in a sample")
            }
            return date
        }

        private static func run(_ json: String) -> Run {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            do {
                return try decoder.decode(Run.self, from: Data(json.utf8))
            } catch {
                preconditionFailure("A sample run does not decode: \(error)")
            }
        }
    }
#endif
