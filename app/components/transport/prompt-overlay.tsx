import type { Interaction } from "../../../workers/protocol";

import { PermissionConfirmation } from "./permission-confirmation";
import { QuestionForm } from "./question-form";

export function PromptOverlay({
	interactions,
	onPermission,
	onQuestion,
}: {
	interactions: Interaction[];
	onPermission: (id: string, decision: "allow" | "deny") => void;
	onQuestion: (
		id: string,
		answers: { questionIndex: number; selectedOptions: string[] }[],
	) => void;
}) {
	if (interactions.length === 0) return null;

	return (
		<div className="pointer-events-none absolute inset-0 z-30 flex items-end bg-gradient-to-t from-background via-background/80 to-transparent px-3 pt-12">
			<div className="pointer-events-auto mx-auto max-h-full w-full max-w-3xl space-y-2 overflow-y-auto pb-3">
				{interactions.map((interaction) =>
					interaction.kind === "permission" ? (
						<PermissionConfirmation
							key={interaction.id}
							interaction={interaction}
							onAnswer={onPermission}
						/>
					) : (
						<QuestionForm
							key={interaction.id}
							interaction={interaction}
							onAnswer={onQuestion}
						/>
					),
				)}
			</div>
		</div>
	);
}
