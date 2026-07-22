import { describe, expect, test } from "bun:test";
import { getToolDetail, ToolDetailKind } from "@/lib/tool-detail";

describe("getToolDetail", () => {
	test("Bash yields the command", () => {
		const detail = getToolDetail({
			toolName: "Bash",
			toolInput: { command: "rm -rf dist", description: "Clean build" },
		});
		expect(detail).toEqual({
			kind: ToolDetailKind.Command,
			title: "rm -rf dist",
			oldText: "",
			newText: "",
		});
	});

	test("Edit yields a diff", () => {
		const detail = getToolDetail({
			toolName: "Edit",
			toolInput: {
				file_path: "/tmp/a.ts",
				old_string: "const a = 1",
				new_string: "const a = 2",
			},
		});
		expect(detail).toEqual({
			kind: ToolDetailKind.Diff,
			title: "/tmp/a.ts",
			oldText: "const a = 1",
			newText: "const a = 2",
		});
	});

	test("Write yields a diff against empty", () => {
		const detail = getToolDetail({
			toolName: "Write",
			toolInput: { file_path: "/tmp/b.ts", content: "hello" },
		});
		expect(detail).toEqual({
			kind: ToolDetailKind.Diff,
			title: "/tmp/b.ts",
			oldText: "",
			newText: "hello",
		});
	});

	test("unknown tools yield compact json", () => {
		const detail = getToolDetail({
			toolName: "WebFetch",
			toolInput: { url: "https://x.dev" },
		});
		expect(detail?.kind).toBe(ToolDetailKind.Text);
		expect(detail?.title).toContain("https://x.dev");
	});

	test("empty input yields nothing to show", () => {
		expect(getToolDetail({ toolName: "", toolInput: null })).toBeNull();
	});
});
