import type { ToolInput } from "@/lib/tool-detail";

interface SuggestRuleParams {
	toolName: string;
	toolInput: ToolInput;
}

/// Claude Code permission rule for "always allow": two leading tokens cover
/// the common `<binary> <subcommand>` shape without allowing everything.
export function suggestRule({
	toolName,
	toolInput,
}: SuggestRuleParams): string | null {
	if (!toolName) return null;
	if (toolName !== "Bash") return toolName;

	const command = String(toolInput?.command ?? "").trim();
	if (!command) return toolName;

	const tokens = command.split(/\s+/);
	return tokens.length === 1
		? `Bash(${command})`
		: `Bash(${tokens.slice(0, 2).join(" ")}:*)`;
}
