import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoices,
	QuestionnaireDescription,
	QuestionnaireInput,
	QuestionnaireItem,
	QuestionnaireNext,
	QuestionnaireProgress,
	QuestionnaireSkip,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "~/components/ui/questionnaire";
import type { QuestionInteraction } from "../../../workers/protocol";

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

	return (
		<div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
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
						<QuestionnaireDescription>{question.header}</QuestionnaireDescription>
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
								aria-label={`Jawaban lain untuk ${question.header}`}
								placeholder="Atau tulis jawaban bebas…"
							/>
						</QuestionnaireChoices>
					</QuestionnaireItem>
				))}
				<QuestionnaireActions>
					<QuestionnaireSkip />
					<QuestionnaireNext>Next</QuestionnaireNext>
					<QuestionnaireSubmit>Send answers</QuestionnaireSubmit>
				</QuestionnaireActions>
			</Questionnaire>
		</div>
	);
}
