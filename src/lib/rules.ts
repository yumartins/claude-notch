import type { ToolInput } from "@/lib/tool-detail";

interface SuggestRuleParams {
	toolName: string;
	toolInput: ToolInput;
}

/// "Always allow" permission rule: any command-carrying tool (Claude's `Bash`,
/// Cursor's `Shell`) is scoped to its two leading tokens — the common
/// `<binary> <subcommand>` shape — so the grant covers reruns without allowing
/// everything. Tools without a command become a bare tool rule.
export function suggestRule({
	toolName,
	toolInput,
}: SuggestRuleParams): string | null {
	if (!toolName) return null;

	const command = String(toolInput?.command ?? "").trim();
	if (!command) return toolName;

	const tokens = command.split(/\s+/);
	return tokens.length === 1
		? `${toolName}(${command})`
		: `${toolName}(${tokens.slice(0, 2).join(" ")}:*)`;
}
