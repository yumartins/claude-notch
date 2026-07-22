export enum ToolDetailKind {
	Command = "command",
	Diff = "diff",
	Text = "text",
}

export interface ToolDetail {
	kind: ToolDetailKind;
	title: string;
	oldText: string;
	newText: string;
}

export type ToolInput = Record<string, unknown> | null;

interface GetToolDetailParams {
	toolName: string;
	toolInput: ToolInput;
}

const TITLE_LIMIT = 2_000;

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

const DETAIL_BUILDERS: Record<
	string,
	(input: Record<string, unknown>) => ToolDetail
> = {
	Bash: (input) => ({
		kind: ToolDetailKind.Command,
		title: str(input.command),
		oldText: "",
		newText: "",
	}),
	Edit: (input) => ({
		kind: ToolDetailKind.Diff,
		title: str(input.file_path),
		oldText: str(input.old_string),
		newText: str(input.new_string),
	}),
	Write: (input) => ({
		kind: ToolDetailKind.Diff,
		title: str(input.file_path),
		oldText: "",
		newText: str(input.content),
	}),
};

function genericDetail(input: Record<string, unknown>): ToolDetail {
	return {
		kind: ToolDetailKind.Text,
		title: JSON.stringify(input).slice(0, TITLE_LIMIT),
		oldText: "",
		newText: "",
	};
}

export function getToolDetail({
	toolName,
	toolInput,
}: GetToolDetailParams): ToolDetail | null {
	if (!toolName || !toolInput) return null;
	const build = DETAIL_BUILDERS[toolName] ?? genericDetail;
	const detail = build(toolInput);
	return detail.title ? detail : null;
}
