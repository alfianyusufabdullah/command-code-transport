import type { AnswerEntry, Question, QuestionOption } from "./types";

export function normalizeQuestions(
	input: Record<string, unknown> | undefined,
): Question[] | null {
	const raw = input?.questions;
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const questions: Question[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") return null;
		const value = item as Record<string, unknown>;
		if (typeof value.question !== "string" || typeof value.header !== "string") return null;
		if (!Array.isArray(value.options)) return null;
		const options: QuestionOption[] = [];
		for (const option of value.options) {
			if (!option || typeof option !== "object") continue;
			const entry = option as Record<string, unknown>;
			if (typeof entry.label !== "string") continue;
			options.push({
				label: entry.label,
				description: typeof entry.description === "string" ? entry.description : undefined,
				preview: typeof entry.preview === "string" ? entry.preview : undefined,
			});
		}
		questions.push({
			question: value.question,
			header: value.header,
			options,
			multiSelect: value.multiSelect === true,
		});
	}
	return questions;
}

export function formatAnswers(questions: Question[], answers: AnswerEntry[]): string {
	const lines: string[] = [];
	const previews: string[] = [];
	for (const answer of answers) {
		const question = questions[answer.questionIndex];
		if (
			!question ||
			!Array.isArray(answer.selectedOptions) ||
			answer.selectedOptions.length === 0
		) {
			continue;
		}
		lines.push(`${question.question} → ${answer.selectedOptions.join(", ")}`);
		for (const label of answer.selectedOptions) {
			const option = question.options.find((item) => item.label === label);
			if (option?.preview) {
				previews.push(`Selected preview for "${question.question}":\n${option.preview}`);
			}
		}
	}
	if (lines.length === 0) return "User declined to answer questions";
	return [lines.join("\n"), ...previews, "Continue with the user's answers in mind."].join("\n\n");
}
