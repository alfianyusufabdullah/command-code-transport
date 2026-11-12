import { MessagesSquare, Route } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoices,
	QuestionnaireInput,
	QuestionnaireItem,
	QuestionnaireNext,
	QuestionnaireProgress,
	QuestionnaireSkip,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "~/components/ui/questionnaire";
import type { QuestionInteraction } from "../../../workers/protocol";

import { PromptShell } from "./prompt-shell";

export function QuestionForm({
	interaction,
	onAnswer,
}: {
	interaction: QuestionInteraction;
	onAnswer: (
		id: string,
		answers: { questionIndex: number; selectedOptions: string[] }[],
	) => void;
}) {
	const items = interaction.questions.map((_, index) => ({
		name: String(index),
		required: false,
	}));
	const isPlan = interaction.questions.some(
		(question) => question.header.trim().toLowerCase() === "plan",
	);
	const first = interaction.questions[0];

	return (
		<PromptShell
			icon={isPlan ? Route : MessagesSquare}
			eyebrow={isPlan ? "Plan approval" : "Question"}
			title={isPlan ? "Approve plan?" : first?.header || "Agent needs input"}
			tone={isPlan ? "warn" : "info"}
			badge={
				<Badge
					variant="outline"
					className={
						isPlan
							? "border-amber-500/40 text-amber-700 dark:text-amber-300"
							: "border-sky-500/40 text-sky-700 dark:text-sky-300"
					}
				>
					{isPlan ? "plan" : "question"}
				</Badge>
			}
		>
			{interaction.tui ? (
				<p className="text-xs text-muted-foreground">
					This question is open in the terminal. Answer it there; this card closes
					automatically.
				</p>
			) : null}
			<fieldset
				disabled={interaction.tui}
				className={interaction.tui ? "min-w-0 opacity-60" : "min-w-0"}
			>
				<Questionnaire
					items={items}
					onSubmit={(event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					const answers: { questionIndex: number; selectedOptions: string[] }[] = [];
					interaction.questions.forEach((_, index) => {
						const values = data
							.getAll(String(index))
							.filter((value): value is string => typeof value === "string")
							.map((value) => value.trim())
							.filter((value) => value.length > 0);
						if (values.length > 0) {
							answers.push({ questionIndex: index, selectedOptions: values });
						}
					});
					onAnswer(interaction.id, answers);
				}}
			>
				<QuestionnaireProgress />
				{interaction.questions.map((question, index) => (
					<QuestionnaireItem key={index} name={String(index)} multiple={question.multiSelect}>
						<QuestionnaireTitle>{question.question}</QuestionnaireTitle>
						<QuestionnaireChoices>
							{question.options.map((option) => (
								<QuestionnaireChoice key={option.label} value={option.label}>
									<span className="font-medium">{option.label}</span>
									{option.description ? (
										<span className="text-muted-foreground">{option.description}</span>
									) : null}
								</QuestionnaireChoice>
							))}
							<QuestionnaireInput
								aria-label={`Other answer for ${question.header}`}
								placeholder="Or type a custom answer…"
							/>
						</QuestionnaireChoices>
					</QuestionnaireItem>
				))}
				<QuestionnaireActions>
					<QuestionnaireSkip />
					<QuestionnaireNext>Next</QuestionnaireNext>
					<QuestionnaireSubmit>{isPlan ? "Send answer" : "Send answers"}</QuestionnaireSubmit>
				</QuestionnaireActions>
				</Questionnaire>
			</fieldset>
			<p className="text-[11px] text-muted-foreground">
				{interaction.tui
					? "This card closes when the terminal prompt is answered."
					: "Answer here, or let the terminal handle it after the timeout."}
			</p>
		</PromptShell>
	);
}
