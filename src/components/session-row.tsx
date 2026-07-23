import { invoke } from "@tauri-apps/api/core";
import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { ToolDetailView } from "@/components/tool-detail-view";
import { TranscriptPreview } from "@/components/transcript-preview";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { getClawdArt } from "@/lib/clawd";
import {
	getRequestToolSummary,
	PermissionDecision,
	type PermissionRequest,
} from "@/lib/permissions";
import {
	getProvider,
	getProviderLabel,
	Provider,
	supportsPermissionRules,
	supportsTerminalReply,
	supportsTranscript,
} from "@/lib/providers";
import { suggestRule } from "@/lib/rules";
import {
	formatRelativeTime,
	formatTokens,
	formatWorkDuration,
	getActivityLabel,
	getSessionStatus,
	getTerminalLabel,
	hasUsageLimit,
	isActivelyWaiting,
	isAwaitingPermission,
	type Session,
	SessionStatus,
} from "@/lib/sessions";
import { getToolDetail } from "@/lib/tool-detail";
import { cn } from "@/lib/utils";

interface SessionRowProps {
	session: Session;
	request?: PermissionRequest;
	index: number;
	onShowUsage: () => void;
}

interface LimitCardProps {
	message: string;
	onShowUsage: () => void;
}

interface SessionCommandParams {
	sessionId: string;
}

interface SnoozeParams {
	sessionId: string;
	ts: number;
}

interface RespondSessionParams {
	sessionId: string;
	approve: boolean;
}

interface SendTextParams {
	sessionId: string;
	text: string;
}

const STATUS_TEXT_CLASSES: Record<SessionStatus, string> = {
	[SessionStatus.Waiting]: "text-status-waiting",
	[SessionStatus.Running]: "font-mono text-muted-foreground",
	[SessionStatus.Idle]: "text-muted-foreground",
};

function focusSession({ sessionId }: SessionCommandParams) {
	invoke("focus_session", { sessionId }).catch(console.error);
}

function snoozeSession({ sessionId, ts }: SnoozeParams) {
	invoke("snooze_session", { sessionId, ts }).catch(console.error);
}

function unsnoozeSession({ sessionId }: SessionCommandParams) {
	invoke("unsnooze_session", { sessionId }).catch(console.error);
}

interface ReplyBoxProps {
	sessionId: string;
}

function ReplyBox({ sessionId }: ReplyBoxProps) {
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);

	async function send({ sessionId, text }: SendTextParams) {
		setSending(true);
		setError("");
		try {
			await invoke("send_text", { sessionId, text });
			setText("");
		} catch (err) {
			setError(String(err));
		} finally {
			setSending(false);
		}
	}

	function submit() {
		text.trim() && !sending && send({ sessionId, text });
	}

	return (
		<div className="space-y-1">
			<div className="relative">
				<Textarea
					value={text}
					disabled={sending}
					rows={2}
					placeholder="Send a message to Claude…"
					className="min-h-24 pr-11"
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || event.shiftKey) return;
						event.preventDefault();
						submit();
					}}
				/>
				<Button
					size="icon-sm"
					title="Send to terminal"
					disabled={sending || !text.trim()}
					className="absolute right-2 bottom-2.5"
					onClick={submit}
				>
					<ArrowUp />
				</Button>
			</div>
			{error ? <p className="text-destructive text-xs">{error}</p> : null}
		</div>
	);
}

interface PermissionCardProps {
	session: Session;
	onError: (params: { message: string }) => void;
}

function PermissionCard({ session, onError }: PermissionCardProps) {
	const detail = getToolDetail({
		toolName: session.tool_name,
		toolInput: session.tool_input,
	});
	const rule = suggestRule({
		toolName: session.tool_name,
		toolInput: session.tool_input,
	});

	function respond({ sessionId, approve }: RespondSessionParams) {
		invoke("respond_session", { sessionId, approve }).catch((err) =>
			onError({ message: String(err) }),
		);
	}

	async function alwaysAllow() {
		try {
			await invoke("add_permission_rule", {
				cwd: session.cwd,
				rule,
				provider: getProvider({ session }),
			});
			respond({ sessionId: session.session_id, approve: true });
		} catch (err) {
			onError({ message: String(err) });
		}
	}

	return (
		<div className="space-y-2">
			{detail ? (
				<ToolDetailView detail={detail} />
			) : (
				<p className="truncate rounded-r-lg border-status-waiting/60 border-l-2 bg-status-waiting/10 px-2.5 py-2 font-mono text-sm text-status-waiting">
					{session.tool}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					className="flex-1 rounded-md font-semibold"
					onClick={() =>
						respond({ sessionId: session.session_id, approve: true })
					}
				>
					Approve <span className="font-mono opacity-60">↩</span>
				</Button>
				<Button
					variant="secondary"
					className="flex-1 rounded-md font-semibold"
					onClick={() =>
						respond({ sessionId: session.session_id, approve: false })
					}
				>
					Deny <span className="font-mono opacity-50">esc</span>
				</Button>
			</div>
			{rule && session.cwd ? (
				<Button
					size="xs"
					variant="ghost-muted"
					title={rule}
					className="w-full"
					onClick={alwaysAllow}
				>
					Always allow
				</Button>
			) : null}
		</div>
	);
}

interface SocketPermissionCardProps {
	session: Session;
	request: PermissionRequest;
	onError: (params: { message: string }) => void;
}

interface ResolveParams {
	decision: PermissionDecision;
}

const PASSTHROUGH_LABELS: Record<Provider, string> = {
	[Provider.Claude]: "Answer in terminal",
	[Provider.Codex]: "Answer in terminal",
	[Provider.Cursor]: "Answer in Cursor",
};

// Approval card for requests arriving over the app socket: the agent hook is
// blocked waiting, so the decision goes straight back to it — no keystrokes.
function SocketPermissionCard({
	session,
	request,
	onError,
}: SocketPermissionCardProps) {
	const detail = getToolDetail({
		toolName: request.tool_name,
		toolInput: request.tool_input,
	});
	const rule = suggestRule({
		toolName: request.tool_name,
		toolInput: request.tool_input,
	});

	function resolve({ decision }: ResolveParams) {
		invoke("resolve_permission", {
			requestId: request.request_id,
			decision,
		}).catch((err) => onError({ message: String(err) }));
	}

	async function alwaysAllow() {
		try {
			await invoke("add_permission_rule", {
				cwd: request.cwd,
				rule,
				provider: getProvider({ session }),
			});
			resolve({ decision: PermissionDecision.Allow });
		} catch (err) {
			onError({ message: String(err) });
		}
	}

	return (
		<div className="space-y-2">
			{detail ? (
				<ToolDetailView detail={detail} />
			) : (
				<p className="truncate rounded-r-lg border-status-waiting/60 border-l-2 bg-status-waiting/10 px-2.5 py-2 font-mono text-sm text-status-waiting">
					{getRequestToolSummary({ request })}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					className="flex-1 rounded-md font-semibold"
					onClick={() => resolve({ decision: PermissionDecision.Allow })}
				>
					Approve
				</Button>
				<Button
					variant="secondary"
					className="flex-1 rounded-md font-semibold"
					onClick={() => resolve({ decision: PermissionDecision.Deny })}
				>
					Deny
				</Button>
			</div>
			<Button
				size="sm"
				variant="ghost-muted"
				className="w-full"
				onClick={() => resolve({ decision: PermissionDecision.Passthrough })}
			>
				{PASSTHROUGH_LABELS[getProvider({ session })]}
			</Button>
			{supportsPermissionRules({ session }) && rule && request.cwd ? (
				<Button
					size="sm"
					variant="ghost-muted"
					title={rule}
					className="w-full"
					onClick={alwaysAllow}
				>
					Always allow
				</Button>
			) : null}
		</div>
	);
}

function LimitCard({ message, onShowUsage }: LimitCardProps) {
	return (
		<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5">
			<p className="font-bold text-destructive text-sm">Usage limit reached</p>
			{message ? (
				<p className="mt-1 font-mono text-muted-foreground text-xs leading-relaxed">
					{message}
				</p>
			) : null}
			<Button size="sm" className="mt-2 font-semibold" onClick={onShowUsage}>
				View plan usage
			</Button>
		</div>
	);
}

export function SessionRow({
	session,
	request,
	index,
	onShowUsage,
}: SessionRowProps) {
	const status = getSessionStatus({ session });
	const isWaiting = isActivelyWaiting({ session });
	const isLimited = hasUsageLimit({ session });
	const provider = getProvider({ session });
	const keystrokeFallback =
		!request &&
		provider === Provider.Claude &&
		isAwaitingPermission({ session });
	const [error, setError] = useState("");

	const duration = formatWorkDuration({
		startedAt: session.started_at,
		ts: session.ts,
	});
	const metaLine = [
		session.cwd,
		session.context_tokens > 0
			? `${formatTokens({ count: session.context_tokens })} ctx`
			: "",
		duration ? `${duration} session` : "",
		getTerminalLabel({ session }),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Collapsible
			className="mb-0.5 animate-row-in rounded-lg border border-transparent transition-colors has-data-panel-open:border-border has-data-panel-open:bg-card motion-reduce:animate-none"
			style={{ animationDelay: `${index * 45}ms` }}
		>
			<CollapsibleTrigger className="group flex w-full items-center gap-3 rounded-lg p-3 text-left transition-[background-color,transform] hover:bg-card active:scale-98 data-panel-open:bg-transparent">
				<img
					src={getClawdArt({ status })}
					alt=""
					className={cn(
						"size-7 flex-none",
						status === SessionStatus.Idle && "opacity-60",
						isWaiting && "animate-glow motion-reduce:animate-none",
					)}
				/>
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline justify-between gap-2">
						<span className="flex min-w-0 items-baseline gap-1.5">
							<span className="truncate font-semibold text-base text-foreground tracking-tight">
								{session.project || "unnamed"}
							</span>
							{provider !== Provider.Claude ? (
								<span className="flex-none rounded-sm bg-secondary px-1.5 font-medium text-muted-foreground text-xs">
									{getProviderLabel({ session })}
								</span>
							) : null}
						</span>
						<span className="flex-none text-muted-foreground text-xs tabular-nums">
							{formatRelativeTime({
								timestamp: session.ts,
								now: Date.now() / 1000,
							})}
						</span>
					</span>
					<span
						className={cn(
							"block truncate text-sm",
							isLimited && "text-destructive",
							!isLimited && session.snoozed && "text-muted-foreground",
							!isLimited && !session.snoozed && STATUS_TEXT_CLASSES[status],
						)}
					>
						{getActivityLabel({ session })}
					</span>
				</span>
			</CollapsibleTrigger>

			<CollapsibleContent className="space-y-2 px-3 pb-3">
				{session.message ? (
					<p className="text-muted-foreground text-sm leading-relaxed">
						{session.message}
					</p>
				) : null}
				{isLimited ? (
					<LimitCard
						message={session.limit_message}
						onShowUsage={onShowUsage}
					/>
				) : null}
				{request ? (
					<SocketPermissionCard
						session={session}
						request={request}
						onError={({ message }) => setError(message)}
					/>
				) : null}
				{keystrokeFallback ? (
					<PermissionCard
						session={session}
						onError={({ message }) => setError(message)}
					/>
				) : null}
				{supportsTranscript({ session }) ? (
					<TranscriptPreview
						sessionId={session.session_id}
						assistantLabel={getProviderLabel({ session })}
					/>
				) : null}
				{supportsTerminalReply({ session }) ? (
					<ReplyBox sessionId={session.session_id} />
				) : null}
				{error ? <p className="text-destructive text-xs">{error}</p> : null}
				{session.snoozed ? (
					<Button
						size="sm"
						variant="ghost-muted"
						className="w-full"
						onClick={() => unsnoozeSession({ sessionId: session.session_id })}
					>
						Un-snooze
					</Button>
				) : isWaiting ? (
					<Button
						size="sm"
						variant="ghost-muted"
						className="w-full"
						onClick={() =>
							snoozeSession({ sessionId: session.session_id, ts: session.ts })
						}
					>
						Snooze
					</Button>
				) : null}
				<Button
					size="sm"
					variant="ghost-muted"
					className="w-full"
					onClick={() => focusSession({ sessionId: session.session_id })}
				>
					Focus terminal →
				</Button>
				<p
					className="truncate text-center font-mono text-muted-foreground/70 text-xs"
					title={metaLine}
				>
					{metaLine}
				</p>
			</CollapsibleContent>
		</Collapsible>
	);
}
