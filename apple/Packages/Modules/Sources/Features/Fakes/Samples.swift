#if DEBUG
    import Backend
    import Foundation

    /// Made-up agents, tasks, and runs, for previews and tests. Runs are written as `/api` sends them.
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
              "agentId": "1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e",
              "taskId": "\(weatherTask.id)",
              "postId": null,
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

        static let mailRun = run(
            """
            {
              "id": "2f4e6a8c-0b1d-4e3f-8a5c-7d9e1f3a5b7c",
              "agentId": "1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e",
              "taskId": null,
              "postId": "a1b2c3d4-0001-4a00-8000-000000000001",
              "startedAt": "2026-11-10T00:00:00Z",
              "endedAt": "2026-11-10T00:04:00Z",
              "lastError": null,
              "failedAttempts": 0,
              "messages": [
                {"role": "user", "text": "昨日届いたメールを確認して、返信が必要そうなものをトリアージして教えて"},
                {"role": "assistant", "parts": [
                  {"type": "text", "text": "今から確認します。"},
                  {"type": "tool-call", "id": "call-1", "name": "maillist", "input": {"since": "2026-11-09"}}
                ]},
                {"role": "tool", "callId": "call-1", "isError": false, "content": "42 件のメールがあります。"},
                {"role": "assistant", "parts": [
                  {"type": "text", "text": "返信が要りそうなものを開いて確かめます。"},
                  {"type": "tool-call", "id": "call-2", "name": "mailread", "input": {"id": "m-12"}}
                ]},
                {"role": "tool", "callId": "call-2", "isError": false, "content": "件名: 来週の打ち合わせ\\n日程の候補を 3 つ挙げてほしい、とのこと。"},
                {"role": "assistant", "parts": [
                  {"type": "tool-call", "id": "call-3", "name": "mailread", "input": {"id": "m-31"}}
                ]},
                {"role": "tool", "callId": "call-3", "isError": false, "content": "件名: 請求書の確認\\n金曜までに返事がほしい、とのこと。"},
                {"role": "assistant", "parts": [
                  {"type": "text", "text": "返信が要りそうなのは 2 件です。打ち合わせの日程と、金曜が期限の請求書の確認です。"}
                ]}
              ]
            }
            """)

        static let retryingRun = run(
            """
            {
              "id": "5a7b9c1d-3e5f-4a6b-8c0d-2e4f6a8b0c1e",
              "agentId": "1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e",
              "taskId": "\(newsTask.id)",
              "postId": null,
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
              "agentId": "1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e",
              "taskId": null,
              "postId": "a1b2c3d4-0002-4a00-8000-000000000002",
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

        /// A message the user just sent, waiting for the agent's reply.
        static let sentRun = run(
            """
            {
              "id": "9c1e3a5b-7d9f-4b1c-8e2a-4c6e8a0b2d4f",
              "agentId": "1f0e2d3c-4b5a-4968-8778-695a4b3c2d1e",
              "taskId": null,
              "postId": "a1b2c3d4-0003-4a00-8000-000000000003",
              "startedAt": "2026-11-10T00:05:00Z",
              "endedAt": null,
              "lastError": null,
              "failedAttempts": 0,
              "messages": [
                {"role": "user", "text": "請求書の件、返信の下書きを作って。"}
              ]
            }
            """)

        /// The posts the sample runs that a post started reply to, each with its run's first message and start.
        static let mailPost = post(of: mailRun)
        static let gaveUpPost = post(of: gaveUpRun)
        static let sentPost = post(of: sentRun)

        static func post(of run: Run) -> Post {
            guard let postID = run.postId, case .case1(let first)? = run.messages.first else {
                preconditionFailure("Sample run \(run.id) doesn't reply to a post.")
            }
            return Post(id: postID, agentId: nil, text: first.text, createdAt: run.startedAt)
        }

        /// What the events socket says when a post was sent.
        static func posted(_ post: Post) -> RunEvent {
            .case3(.init(_type: .post, post: post))
        }

        /// The model is asked and hasn't written anything yet.
        static let thinking = RunProgress.case2(.init(_type: .thinking))

        /// The model is writing, with `text` so far.
        static func writing(_ text: String) -> RunProgress {
            .case3(.init(_type: .writing, text: text))
        }

        /// What the events socket says when `run` changed.
        static func changed(_ run: Run) -> RunEvent {
            .case1(.init(_type: .run, run: run))
        }

        /// What the events socket says about how `run` is getting on.
        static func progress(_ progress: RunProgress, of run: Run) -> RunEvent {
            .case2(.init(_type: .progress, runId: run.id, progress: progress))
        }

        /// Many agents, for seeing that the home holds up when there are more than fit on the screen.
        static let agents: [Agent] =
            [
                Agent(
                    id: "mail", name: "メールの整理", look: AgentLook(palette: 2, seed: 12034),
                    lastRanAt: moment("2026-11-10T00:00:00Z")),
                Agent(
                    id: "stocks", name: "株価の確認", look: AgentLook(palette: 0, seed: 9808),
                    lastRanAt: moment("2026-11-09T23:50:00Z")),
                Agent(
                    id: "news", name: "ニュースのまとめ", look: AgentLook(palette: 6, seed: 74854),
                    lastRanAt: moment("2026-11-09T20:00:00Z")),
                Agent(id: "new", name: "まだ動いていないエージェント", look: AgentLook(palette: 4, seed: 44916), lastRanAt: nil),
            ]
            + (1...16).map {
                Agent(
                    id: "pod-\($0)", name: "Pod \($0)", look: AgentLook(palette: $0, seed: $0 * 7919),
                    lastRanAt: moment("2026-11-01T00:00:00Z"))
            }

        /// A group of two agents first, then each agent's one-to-one thread, as the home lists them.
        static let threads: [ChatThread] =
            [
                ChatThread(
                    id: "team", name: "朝のチーム", agentId: nil, agentIds: ["mail", "stocks"],
                    lastActivityAt: moment("2026-11-10T00:10:00Z"))
            ]
            + agents.map {
                ChatThread(
                    id: "thread-\($0.id)", name: $0.name, agentId: $0.id, agentIds: [$0.id],
                    lastActivityAt: $0.lastRanAt ?? moment("2026-11-01T00:00:00Z"))
            }

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
