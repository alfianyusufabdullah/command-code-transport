import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { cn } from "~/lib/utils";
import type { SkillInfo } from "../../../workers/protocol";

export function Composer({
	disabled,
	busy,
	skills,
	onSend,
}: {
	disabled: boolean;
	busy: boolean;
	skills: SkillInfo[];
	onSend: (text: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const activeItemRef = useRef<HTMLButtonElement | null>(null);
	const blocked = disabled || busy;

	const slashQuery =
		!blocked && draft.startsWith("/") && !/\s/.test(draft) ? draft.slice(1) : null;
	const query = slashQuery?.replace(/^skill:/, "") ?? "";
	const filteredSkills = useMemo(() => {
		if (slashQuery === null) return [];
		const needle = query.toLowerCase();
		return skills
			.filter(
				(skill) =>
					!needle ||
					skill.name.toLowerCase().includes(needle) ||
					skill.description.toLowerCase().includes(needle),
			)
			.sort(
				(left, right) =>
					Number(right.name.toLowerCase().startsWith(needle)) -
					Number(left.name.toLowerCase().startsWith(needle)),
			);
	}, [skills, slashQuery, query]);
	const index = filteredSkills.length ? Math.min(activeIndex, filteredSkills.length - 1) : 0;
	const activeSkill = filteredSkills[index];
	const menuOpen = !blocked && !dismissed && slashQuery !== null && filteredSkills.length > 0;

	useEffect(() => {
		setActiveIndex(0);
		setDismissed(false);
	}, [draft]);

	useEffect(() => {
		if (menuOpen) activeItemRef.current?.scrollIntoView({ block: "nearest" });
	}, [index, menuOpen]);

	const normalize = (text: string) => {
		const match = /^\/skill\s+(\S+)(?:\s+([\s\S]*))?$/.exec(text);
		if (!match) return text;
		const skill = skills.find((item) => item.name === match[1]);
		return skill
			? `/skill:${skill.name}${match[2] ? ` ${match[2]}` : ""}`
			: text;
	};

	const submit = () => {
		const text = normalize(draft.trim());
		if (blocked || !text) return;
		onSend(text);
		setDraft("");
		setDismissed(true);
	};

	const insert = (skill: SkillInfo) => {
		setDraft(`/skill:${skill.name} `);
		setDismissed(true);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (menuOpen && activeSkill) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveIndex((index + 1) % filteredSkills.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setActiveIndex((index - 1 + filteredSkills.length) % filteredSkills.length);
				return;
			}
			if (event.key === "Tab") {
				event.preventDefault();
				insert(activeSkill);
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				insert(activeSkill);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setDismissed(true);
				return;
			}
		}

		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			formRef.current?.requestSubmit();
		}
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
					{menuOpen ? (
						<div className="absolute inset-x-0 bottom-full z-50 mb-2">
							<ScrollArea
								viewportClassName="max-h-64"
								className="rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
							>
								<div className="p-1">
									<div className="px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
										Skills
									</div>
									{filteredSkills.map((skill, optionIndex) => (
										<button
											key={skill.name}
											ref={optionIndex === index ? activeItemRef : undefined}
											type="button"
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => insert(skill)}
											className={cn(
												"flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
												optionIndex === index
													? "bg-accent text-accent-foreground"
													: "hover:bg-accent/50",
											)}
										>
											<Sparkles className="mt-0.5 size-3.5 shrink-0" />
											<div className="flex min-w-0 flex-col gap-0.5">
												<span className="flex items-center gap-2 text-sm font-medium">
													{skill.name}
													<span className="text-[10px] tracking-wide text-muted-foreground uppercase">
														{skill.source}
													</span>
													{skill.argumentHint ? (
														<span className="truncate text-[10px] font-normal text-muted-foreground">
															{skill.argumentHint}
														</span>
													) : null}
												</span>
												<span className="line-clamp-2 text-xs text-muted-foreground">
													{skill.description}
												</span>
											</div>
										</button>
									))}
								</div>
							</ScrollArea>
						</div>
					) : null}
					<Textarea
						ref={textareaRef}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={handleKeyDown}
						rows={1}
						placeholder={
							busy
								? "Agent is working…"
								: disabled
									? "Select a session first"
									: "Ask Command Code… or type / for skills"
						}
						aria-label="Message"
						disabled={blocked}
						className="max-h-40 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
					/>
					<div className="flex items-center justify-between gap-2 px-3 pb-2">
						<span className="truncate px-1 text-[10px] text-muted-foreground">
							{busy
								? "Waiting for the agent to finish"
								: menuOpen
									? "↑↓ navigate · Enter / Tab insert · Esc close"
									: "Enter to send · Shift+Enter for a new line"}
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
