import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useTheme, type Theme } from "~/components/theme-provider";

const options: { value: Theme; label: string; icon: typeof Sun }[] = [
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
	{ value: "system", label: "System", icon: Monitor },
];

export function ModeToggle() {
	const { theme, setTheme } = useTheme();
	const ActiveIcon = options.find((option) => option.value === theme)?.icon ?? Monitor;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label="Theme">
					<ActiveIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{options.map(({ value, label, icon: Icon }) => (
					<DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
						<Icon />
						{label}
						<span className="ml-auto text-muted-foreground">{theme === value ? "✓" : ""}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
