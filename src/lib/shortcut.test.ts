import { describe, expect, test } from "bun:test";
import { formatShortcutGlyphs, shortcutFromEvent } from "@/lib/shortcut";

interface BuildEventParams {
	key: string;
	meta?: boolean;
	alt?: boolean;
	ctrl?: boolean;
	shift?: boolean;
}

function buildEvent({ key, meta, alt, ctrl, shift }: BuildEventParams) {
	return {
		key,
		metaKey: meta ?? false,
		altKey: alt ?? false,
		ctrlKey: ctrl ?? false,
		shiftKey: shift ?? false,
	};
}

describe("shortcutFromEvent", () => {
	test("builds a modifier+key accelerator", () => {
		const event = buildEvent({ key: "c", meta: true, alt: true });
		expect(shortcutFromEvent({ event })).toBe("alt+cmd+c");
	});

	test("ignores modifier-only presses", () => {
		expect(
			shortcutFromEvent({ event: buildEvent({ key: "Meta" }) }),
		).toBeNull();
	});

	test("requires at least one modifier", () => {
		expect(shortcutFromEvent({ event: buildEvent({ key: "c" }) })).toBeNull();
	});

	test("maps space to a named key", () => {
		const event = buildEvent({ key: " ", ctrl: true });
		expect(shortcutFromEvent({ event })).toBe("ctrl+space");
	});
});

describe("formatShortcutGlyphs", () => {
	test("renders macOS modifier glyphs", () => {
		expect(formatShortcutGlyphs({ shortcut: "cmd+alt+c" })).toBe("⌘⌥C");
		expect(formatShortcutGlyphs({ shortcut: "ctrl+shift+space" })).toBe(
			"⌃⇧SPACE",
		);
	});
});
