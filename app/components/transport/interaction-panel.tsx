import type { Interaction } from "../../../workers/protocol";

import { PermissionConfirmation } from "./permission-confirmation";
import { QuestionForm } from "./question-form";

export function InteractionPanel({
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
		<div className="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-border bg-background px-4 py-3">
			<div className="mx-auto w-full max-w-3xl space-y-2">
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
