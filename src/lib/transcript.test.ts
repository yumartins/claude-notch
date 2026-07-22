import { describe, expect, test } from "bun:test";
import { parseTranscriptTail, TranscriptRole } from "@/lib/transcript";

function line(entry: unknown): string {
	return JSON.stringify(entry);
}

const assistantText = line({
	type: "assistant",
	message: {
		role: "assistant",
		content: [{ type: "text", text: "Vou ler o arquivo agora." }],
	},
});

const assistantTool = line({
	type: "assistant",
	message: {
		role: "assistant",
		content: [
			{ type: "text", text: "Rodando os testes." },
			{ type: "tool_use", name: "Bash", input: { command: "bun test" } },
		],
	},
});

const userText = line({
	type: "user",
	message: { role: "user", content: "Implementa a feature X" },
});

const userToolResult = line({
	type: "user",
	message: {
		role: "user",
		content: [{ type: "tool_result", content: "ok" }],
	},
});

const sidechain = line({
	type: "assistant",
	isSidechain: true,
	message: {
		role: "assistant",
		content: [{ type: "text", text: "subagent noise" }],
	},
});

const meta = line({
	type: "user",
	isMeta: true,
	message: {
		role: "user",
		content: "<system-reminder>noise</system-reminder>",
	},
});

describe("parseTranscriptTail", () => {
	test("extracts user and assistant messages in order", () => {
		const text = [userText, assistantText].join("\n");
		const items = parseTranscriptTail({ text, limit: 10 });
		expect(items).toEqual([
			{ role: TranscriptRole.User, text: "Implementa a feature X", tools: [] },
			{
				role: TranscriptRole.Assistant,
				text: "Vou ler o arquivo agora.",
				tools: [],
			},
		]);
	});

	test("captures tool calls as summaries", () => {
		const items = parseTranscriptTail({ text: assistantTool, limit: 10 });
		expect(items).toEqual([
			{
				role: TranscriptRole.Assistant,
				text: "Rodando os testes.",
				tools: ["Bash · bun test"],
			},
		]);
	});

	test("skips tool results, sidechain and meta entries", () => {
		const text = [meta, userToolResult, sidechain, assistantText].join("\n");
		const items = parseTranscriptTail({ text, limit: 10 });
		expect(items).toHaveLength(1);
		expect(items[0]?.role).toBe(TranscriptRole.Assistant);
	});

	test("keeps only the last N items", () => {
		const text = [userText, assistantText, assistantTool].join("\n");
		const items = parseTranscriptTail({ text, limit: 2 });
		expect(items).toHaveLength(2);
		expect(items[0]?.text).toBe("Vou ler o arquivo agora.");
	});

	test("ignores the possibly truncated first line and garbage", () => {
		const text = [`{"type":"assis`, "not json", assistantText].join("\n");
		const items = parseTranscriptTail({ text, limit: 10 });
		expect(items).toHaveLength(1);
	});
});
