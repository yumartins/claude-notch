export enum SessionStatus {
	Waiting = "waiting",
	Running = "running",
	Idle = "idle",
}

export enum SessionKind {
	PermissionPrompt = "permission_prompt",
	IdlePrompt = "idle_prompt",
}

export interface Session {
	session_id: string;
	project: string;
	cwd: string;
	status: string;
	message: string;
	tool: string;
	tool_name: string;
	tool_input: Record<string, unknown> | null;
	type: string;
	tty: string;
	term_program: string;
	last_message: string;
	limit_message: string;
	context_tokens: number;
	output_tokens: number;
	provider: string;
	started_at: number;
	ts: number;
}

interface FormatTokensParams {
	count: number;
}

interface GetFolderNameParams {
	path: string;
}

interface SessionParams {
	session: Session;
}

interface SessionsParams {
	sessions: Session[];
}

interface FormatRelativeTimeParams {
	timestamp: number;
	now: number;
}

const STATUS_LABELS: Record<SessionStatus, string> = {
	[SessionStatus.Waiting]: "Ocioso, aguardando você",
	[SessionStatus.Running]: "Trabalhando…",
	[SessionStatus.Idle]: "Sem pendências",
};

const KNOWN_STATUSES = new Set<string>(Object.values(SessionStatus));

const TERMINAL_LABELS: Record<string, string> = {
	Apple_Terminal: "Terminal",
	"iTerm.app": "iTerm2",
	vscode: "VS Code",
	WarpTerminal: "Warp",
	ghostty: "Ghostty",
	WezTerm: "WezTerm",
	kitty: "kitty",
	Hyper: "Hyper",
	Tabby: "Tabby",
	alacritty: "Alacritty",
};

export function getSessionStatus({ session }: SessionParams): SessionStatus {
	return KNOWN_STATUSES.has(session.status)
		? (session.status as SessionStatus)
		: SessionStatus.Idle;
}

export function getStatusLabel({ session }: SessionParams): string {
	const status = getSessionStatus({ session });

	const isPermissionPrompt =
		status === SessionStatus.Waiting &&
		session.type === SessionKind.PermissionPrompt;

	return isPermissionPrompt ? "Aguardando permissão" : STATUS_LABELS[status];
}

export function hasUsageLimit({ session }: SessionParams): boolean {
	return session.limit_message !== "";
}

export function isAwaitingPermission({ session }: SessionParams): boolean {
	return (
		getSessionStatus({ session }) === SessionStatus.Waiting &&
		session.type === SessionKind.PermissionPrompt
	);
}

export function getTerminalLabel({ session }: SessionParams): string {
	return (
		TERMINAL_LABELS[session.term_program] ??
		(session.term_program || "Terminal")
	);
}

export function getActivityLabel({ session }: SessionParams): string {
	if (hasUsageLimit({ session })) return "Limite de uso atingido";
	const isRunningTool =
		getSessionStatus({ session }) === SessionStatus.Running &&
		session.tool !== "";
	return isRunningTool ? session.tool : getStatusLabel({ session });
}

export function formatRelativeTime({
	timestamp,
	now,
}: FormatRelativeTimeParams): string {
	if (!timestamp) return "";

	const seconds = Math.max(0, Math.floor(now - timestamp));

	if (seconds < 45) return "agora";
	if (seconds < 3_600) return `${Math.round(seconds / 60)}min`;
	if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`;

	return `${Math.round(seconds / 86_400)}d`;
}

interface FormatWorkDurationParams {
	startedAt: number;
	ts: number;
}

export function formatWorkDuration({
	startedAt,
	ts,
}: FormatWorkDurationParams): string {
	if (!startedAt) return "";
	const seconds = Math.max(0, ts - startedAt);
	if (seconds < 3_600) return `${Math.max(1, Math.round(seconds / 60))}min`;
	return `${toCompactDecimal({ value: seconds / 3_600 })}h`;
}

export function getFolderName({ path }: GetFolderNameParams): string {
	return path.split("/").filter(Boolean).at(-1) ?? path;
}

function toCompactDecimal({ value }: { value: number }): string {
	const rounded = Math.round(value * 10) / 10;
	return String(rounded).replace(".", ",");
}

export function formatTokens({ count }: FormatTokensParams): string {
	if (count < 1_000) return String(count);
	if (count < 1_000_000)
		return `${toCompactDecimal({ value: count / 1_000 })}k`;
	return `${toCompactDecimal({ value: count / 1_000_000 })}M`;
}

export interface StatusCounts {
	waiting: number;
	running: number;
	idle: number;
}

export function countByStatus({ sessions }: SessionsParams): StatusCounts {
	const counts: StatusCounts = { waiting: 0, running: 0, idle: 0 };
	for (const session of sessions) counts[getSessionStatus({ session })] += 1;
	return counts;
}

export function countWaiting({ sessions }: SessionsParams): number {
	return sessions.filter(
		(session) => getSessionStatus({ session }) === SessionStatus.Waiting,
	).length;
}

export function sortSessions({ sessions }: SessionsParams): Session[] {
	return [...sessions].sort(compareSessions);
}

function compareSessions(a: Session, b: Session): number {
	const waitingRank = (session: Session) =>
		getSessionStatus({ session }) === SessionStatus.Waiting ? 0 : 1;
	return waitingRank(a) - waitingRank(b) || (b.ts || 0) - (a.ts || 0);
}

export function getSummary({ sessions }: SessionsParams): string {
	const waiting = countWaiting({ sessions });
	if (waiting > 0) return `${waiting} aguardando`;
	if (sessions.length === 0) return "";
	const noun = sessions.length === 1 ? "sessão" : "sessões";
	return `${sessions.length} ${noun}`;
}
