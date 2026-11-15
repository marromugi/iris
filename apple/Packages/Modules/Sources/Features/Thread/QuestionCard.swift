import Backend
import SwiftUI

/// The answer to a question as the agent reads it: the choices picked, by their place among those offered, in that
/// order, then what the user wrote, joined by "、". Nil when nothing is picked and nothing is written.
func answerText(choices: [String], picked: Set<Int>, written: String) -> String? {
    let parts =
        choices.indices.filter { picked.contains($0) }.map { choices[$0] }
        + [written.trimmingCharacters(in: .whitespacesAndNewlines)].filter { !$0.isEmpty }
    return parts.isEmpty ? nil : parts.joined(separator: "、")
}

/// A question the agent asked, in place of the message field until it is answered: its choices, and a field for an
/// answer of the user's own. With one choice to pick, tapping a choice answers at once; with several, the choices are
/// ticked and sent together with anything written.
struct QuestionCard: View {
    let question: Question
    /// Whether an answer is on its way, which keeps another from being sent.
    let isAnswering: Bool
    let onAnswer: (String) -> Void

    /// The choices ticked, by their place; the card is made anew for each question, so places don't move.
    @State private var picked: Set<Int> = []
    @State private var written = ""

    private var answer: String? {
        answerText(
            choices: question.multiSelect ? question.choices.map(\.label) : [], picked: picked, written: written)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(question.question, systemImage: "questionmark.bubble")
                .font(.headline)
            ForEach(question.choices.indices, id: \.self) { index in
                let choice = question.choices[index]
                ChoiceButton(
                    label: choice.label, description: choice.description,
                    tick: question.multiSelect ? picked.contains(index) : nil
                ) {
                    if question.multiSelect {
                        if picked.contains(index) {
                            picked.remove(index)
                        } else {
                            picked.insert(index)
                        }
                    } else {
                        onAnswer(choice.label)
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(question.multiSelect ? "ほかに書き添える" : "その他の答え", text: $written, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.background, in: .rect(cornerRadius: 20))
                Button {
                    if let answer { onAnswer(answer) }
                } label: {
                    Image(systemName: "paperplane")
                        .rotationEffect(.degrees(45))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.background)
                        .frame(width: 40, height: 40)
                        .background(.primary, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("答えを送る")
                .opacity(answer == nil ? 0.3 : 1)
                .disabled(answer == nil)
            }
        }
        .padding(16)
        .background(.fill.tertiary, in: .rect(cornerRadius: 24))
        .disabled(isAnswering)
        .opacity(isAnswering ? 0.6 : 1)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.background)
    }
}

/// One choice of a question: its label, what choosing it means, and, when several may be picked, whether it is ticked.
private struct ChoiceButton: View {
    let label: String
    let description: String?
    /// Whether it is ticked; nil when tapping it answers at once.
    let tick: Bool?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if let tick {
                    Image(systemName: tick ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                    if let description {
                        Text(description)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: .rect(cornerRadius: 16))
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(tick == true ? .isSelected : [])
    }
}

#if DEBUG
    #Preview("1 つ選ぶ") {
        VStack {
            Spacer()
            QuestionCard(question: Samples.askingQuestion, isAnswering: false) { _ in }
        }
    }

    #Preview("いくつでも選ぶ") {
        var question = Samples.askingQuestion
        question.question = "どの曜日に通知しますか？"
        question.choices = ["月曜", "水曜", "金曜"].map { .init(label: $0) }
        question.multiSelect = true
        return VStack {
            Spacer()
            QuestionCard(question: question, isAnswering: false) { _ in }
        }
    }

    #Preview("送っている途中") {
        VStack {
            Spacer()
            QuestionCard(question: Samples.askingQuestion, isAnswering: true) { _ in }
        }
    }
#endif
