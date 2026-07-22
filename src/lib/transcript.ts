export enum TranscriptRole {
	User = "user",
	Assistant = "assistant",
}

export interface TranscriptItem {
	role: TranscriptRole;
	text: string;
	tools: string[];
}

interface ParseTranscriptTailParams {
	text: string;
	limit: number;
}

interface SummarizeToolUseParams {
	name: string;
	input: Record<string, unknown>;
}

interface ContentPart {
	type?: string;
	text?: string;
	name?: string;
	input?: Record<string, unknown>;
}

const TEXT_LIMIT = 600;

export function summarizeToolUse({
	name,
	input,
}: SummarizeToolUseParams): string {
	const detail = String(
		input.command ?? input.file_path ?? input.path ?? input.pattern ?? "",
	)
		.split(/\s+/)
		.join(" ")
		.slice(0, 120);
	return detail ? `${name} · ${detail}` : name;
}

function parseEntry(line: string): TranscriptItem | null {
	const entry = safeJson({ line });
	if (!entry) return null;
	const { type, isSidechain, isMeta } = entry as {
		type?: string;
		isSidechain?: boolean;
		isMeta?: boolean;
	};
	const isMessage =
		type === TranscriptRole.User || type === TranscriptRole.Assistant;
	if (!isMessage || isSidechain || isMeta) return null;

	const message = (entry as { message?: { content?: string | ContentPart[] } })
		.message;
	const content = message?.content ?? [];
	const parts = typeof content === "string" ? [textPart(content)] : content;

	const text = parts
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join(" ")
		.split(/\s+/)
		.join(" ")
		.trim()
		.slice(0, TEXT_LIMIT);
	const tools = parts
		.filter((part) => part.type === "tool_use")
		.map((part) =>
			summarizeToolUse({ name: part.name ?? "", input: part.input ?? {} }),
		);

	if (!text && tools.length === 0) return null;
	return { role: type as TranscriptRole, text, tools };
}

function textPart(text: string): ContentPart {
	return { type: "text", text };
}

function safeJson({ line }: { line: string }): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

export function parseTranscriptTail({
	text,
	limit,
}: ParseTranscriptTailParams): TranscriptItem[] {
	return text
		.split("\n")
		.map(parseEntry)
		.filter((item): item is TranscriptItem => item !== null)
		.slice(-limit);
}
