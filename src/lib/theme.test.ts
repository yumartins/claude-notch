import { describe, expect, test } from "bun:test";
import { resolveTheme, Theme } from "@/lib/theme";

describe("resolveTheme", () => {
	test("uses the stored preference when valid", () => {
		expect(resolveTheme({ stored: "light", systemDark: true })).toBe(
			Theme.Light,
		);
		expect(resolveTheme({ stored: "dark", systemDark: false })).toBe(
			Theme.Dark,
		);
	});

	test("falls back to the system appearance", () => {
		expect(resolveTheme({ stored: null, systemDark: true })).toBe(Theme.Dark);
		expect(resolveTheme({ stored: "bogus", systemDark: false })).toBe(
			Theme.Light,
		);
	});
});
