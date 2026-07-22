export enum Theme {
	Light = "light",
	Dark = "dark",
}

export const THEME_STORAGE_KEY = "theme";

interface ResolveThemeParams {
	stored: string | null;
	systemDark: boolean;
}

const KNOWN_THEMES = new Set<string>(Object.values(Theme));

export function resolveTheme({
	stored,
	systemDark,
}: ResolveThemeParams): Theme {
	if (KNOWN_THEMES.has(stored ?? "")) return stored as Theme;
	return systemDark ? Theme.Dark : Theme.Light;
}
