export enum PermissionDecision {
	Allow = "allow",
	Deny = "deny",
	Passthrough = "passthrough",
}

export interface PermissionRequest {
	request_id: string;
	provider: string;
	session_id: string;
	tool_name: string;
	tool_input: Record<string, unknown> | null;
	cwd: string;
	project: string;
	ts: number;
}

interface FindRequestForSessionParams {
	requests: PermissionRequest[];
	sessionId: string;
}

interface RequestParams {
	request: PermissionRequest;
}

export function findRequestForSession({
	requests,
	sessionId,
}: FindRequestForSessionParams): PermissionRequest | undefined {
	return requests
		.filter((request) => request.session_id === sessionId)
		.sort((a, b) => a.ts - b.ts)
		.at(0);
}

export function getRequestToolSummary({ request }: RequestParams): string {
	const input = request.tool_input ?? {};
	const detail = String(
		input.command ?? input.file_path ?? input.path ?? input.pattern ?? "",
	);
	const compact = detail.split(/\s+/).join(" ").trim().slice(0, 120);
	return compact ? `${request.tool_name} · ${compact}` : request.tool_name;
}
