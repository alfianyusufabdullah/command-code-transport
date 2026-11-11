import { ArrowUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";

export function Composer({
	disabled,
	busy,
	onSend,
}: {
	disabled: boolean;
	busy: boolean;
	onSend: (text: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const formRef = useRef<HTMLFormElement>(null);
	const blocked = disabled || busy;

	const submit = () => {
		const text = draft.trim();
		if (!text || blocked) return;
		onSend(text);
		setDraft("");
	};

	return (
		<form
			ref={formRef}
			className="shrink-0 bg-gradient-to-t from-background via-background to-background/0 px-3 pt-2 pb-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="mx-auto w-full max-w-3xl">
				<div
					className={cn(
						"relative rounded-2xl border border-border bg-card/95 shadow-sm ring-1 ring-black/5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 dark:ring-white/5",
						busy && "opacity-60",
					)}
				>
					<Textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								formRef.current?.requestSubmit();
							}
						}}
						rows={1}
						placeholder={
							busy
								? "Agent sedang bekerja…"
								: disabled
									? "Pilih sesi dulu"
									: "Tanya Command Code…"
						}
						aria-label="Message"
						disabled={blocked}
						className="max-h-40 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
					/>
					<div className="flex items-center justify-between gap-2 px-3 pb-2">
						<span className="px-1 text-[10px] text-muted-foreground">
							{busy
								? "Menunggu agent selesai"
								: "Enter kirim · Shift+Enter baris baru"}
						</span>
						<Button
							type="submit"
							size="icon-sm"
							className="rounded-full"
							disabled={blocked || draft.trim().length === 0}
							aria-label="Send"
						>
							{busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
						</Button>
					</div>
				</div>
			</div>
		</form>
	);
}
