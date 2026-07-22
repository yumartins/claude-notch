import { useEffect, useState } from "react";
import { resolveTheme, THEME_STORAGE_KEY, Theme } from "@/lib/theme";

interface SetThemeParams {
	theme: Theme;
}

function initialTheme(): Theme {
	return resolveTheme({
		stored: localStorage.getItem(THEME_STORAGE_KEY),
		systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
	});
}

export function useTheme() {
	const [theme, setThemeState] = useState<Theme>(initialTheme);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === Theme.Dark);
	}, [theme]);

	function setTheme({ theme: next }: SetThemeParams) {
		localStorage.setItem(THEME_STORAGE_KEY, next);
		setThemeState(next);
	}

	return { theme, setTheme };
}
