import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "transport-theme";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(e){}})();`;

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
	);
}

function applyTheme(theme: Theme) {
	if (typeof document === "undefined") return;
	const dark = theme === "dark" || (theme === "system" && systemPrefersDark());
	const root = document.documentElement;
	root.classList.toggle("dark", dark);
	root.style.colorScheme = dark ? "dark" : "light";
}

function readStoredTheme(): Theme {
	if (typeof window === "undefined") return "system";
	const value = window.localStorage.getItem(THEME_STORAGE_KEY);
	return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [theme, setThemeState] = useState<Theme>("system");

	useEffect(() => {
		setThemeState(readStoredTheme());
	}, []);

	useEffect(() => {
		applyTheme(theme);
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			if (theme === "system") applyTheme("system");
		};
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [theme]);

	const setTheme = (next: Theme) => {
		window.localStorage.setItem(THEME_STORAGE_KEY, next);
		setThemeState(next);
		applyTheme(next);
	};

	return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) throw new Error("useTheme must be used within ThemeProvider");
	return context;
}
