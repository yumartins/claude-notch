interface ShortcutEventLike {
	key: string;
	metaKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
}

interface ShortcutFromEventParams {
	event: ShortcutEventLike;
}

interface FormatShortcutGlyphsParams {
	shortcut: string;
}

const MODIFIER_KEYS = new Set(["Meta", "Alt", "Control", "Shift"]);

const MODIFIER_GLYPHS: Record<string, string> = {
	ctrl: "⌃",
	alt: "⌥",
	shift: "⇧",
	cmd: "⌘",
};

/// Produces the tauri-plugin-global-shortcut accelerator format, e.g. "alt+cmd+c".
export function shortcutFromEvent({
	event,
}: ShortcutFromEventParams): string | null {
	if (MODIFIER_KEYS.has(event.key)) return null;

	const modifiers = [
		event.ctrlKey && "ctrl",
		event.altKey && "alt",
		event.shiftKey && "shift",
		event.metaKey && "cmd",
	].filter(Boolean) as string[];
	if (modifiers.length === 0) return null;

	const key = event.key === " " ? "space" : event.key.toLowerCase();
	return [...modifiers, key].join("+");
}

export function formatShortcutGlyphs({
	shortcut,
}: FormatShortcutGlyphsParams): string {
	return shortcut
		.split("+")
		.map((part) => MODIFIER_GLYPHS[part.toLowerCase()] ?? part.toUpperCase())
		.join("");
}
