import { describe, expect, test } from "bun:test";
import { suggestRule } from "@/lib/rules";

describe("suggestRule", () => {
	test("multi-word bash commands become a two-token prefix rule", () => {
		expect(
			suggestRule({
				toolName: "Bash",
				toolInput: { command: "bun test src/" },
			}),
		).toBe("Bash(bun test:*)");
	});

	test("single-word bash commands become an exact rule", () => {
		expect(
			suggestRule({ toolName: "Bash", toolInput: { command: "ls" } }),
		).toBe("Bash(ls)");
	});

	test("other tools become a bare tool rule", () => {
		expect(suggestRule({ toolName: "Edit", toolInput: {} })).toBe("Edit");
		expect(suggestRule({ toolName: "WebFetch", toolInput: {} })).toBe(
			"WebFetch",
		);
	});

	test("no tool yields nothing", () => {
		expect(suggestRule({ toolName: "", toolInput: null })).toBeNull();
	});
});
