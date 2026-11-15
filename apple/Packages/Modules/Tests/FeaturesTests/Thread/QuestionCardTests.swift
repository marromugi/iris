import Testing

@testable import Features

struct QuestionCardTests {
    @Test func anAnswerIsTheChoicesPickedInTheOrderOfferedThenWhatWasWritten() {
        #expect(
            answerText(choices: ["月曜", "水曜", "金曜"], picked: ["金曜", "月曜"], written: " 午前だけ \n")
                == "月曜、金曜、午前だけ")
    }

    @Test func nothingPickedOrWrittenIsNoAnswer() {
        #expect(answerText(choices: ["月曜", "水曜"], picked: [], written: "  ") == nil)
    }
}
