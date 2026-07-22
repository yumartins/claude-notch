import { describe, expect, test } from "bun:test";
import { DiffKind, diffLines } from "@/lib/diff";

describe("diffLines", () => {
	test("marks unchanged, removed and added lines", () => {
		const lines = diffLines({
			oldText: "a\nb\nc",
			newText: "a\nx\nc",
		});
		expect(lines).toEqual([
			{ kind: DiffKind.Same, text: "a" },
			{ kind: DiffKind.Removed, text: "b" },
			{ kind: DiffKind.Added, text: "x" },
			{ kind: DiffKind.Same, text: "c" },
		]);
	});

	test("pure insertion", () => {
		const lines = diffLines({ oldText: "", newText: "only new" });
		expect(lines).toEqual([{ kind: DiffKind.Added, text: "only new" }]);
	});

	test("pure deletion", () => {
		const lines = diffLines({ oldText: "gone", newText: "" });
		expect(lines).toEqual([{ kind: DiffKind.Removed, text: "gone" }]);
	});

	test("identical input yields only unchanged lines", () => {
		const lines = diffLines({ oldText: "same\nlines", newText: "same\nlines" });
		expect(lines.every((l) => l.kind === DiffKind.Same)).toBe(true);
	});
});
