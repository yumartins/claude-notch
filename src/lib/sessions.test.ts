import { describe, expect, test } from "bun:test";
import {
	countByStatus,
	formatRelativeTime,
	formatTokens,
	formatWorkDuration,
	getActivityLabel,
	getFolderName,
	getStatusLabel,
	getSummary,
	getTerminalLabel,
	hasUsageLimit,
	isAwaitingPermission,
	type Session,
	SessionKind,
	SessionStatus,
	sortSessions,
} from "@/lib/sessions";

interface BuildSessionParams {
	overrides?: Partial<Session>;
}

function buildSession({ overrides }: BuildSessionParams = {}): Session {
	return {
		session_id: "abc",
		project: "my-project",
		cwd: "/Users/me/dev/my-project",
		status: SessionStatus.Idle,
		message: "",
		tool: "",
		tool_name: "",
		tool_input: null,
		type: "",
		tty: "/dev/ttys003",
		term_program: "Apple_Terminal",
		last_message: "",
		limit_message: "",
		context_tokens: 0,
		output_tokens: 0,
		provider: "claude",
		started_at: 0,
		ts: 1_000,
		...overrides,
	};
}

describe("isAwaitingPermission", () => {
	test("true only for waiting permission prompts", () => {
		const waiting = buildSession({
			overrides: {
				status: SessionStatus.Waiting,
				type: SessionKind.PermissionPrompt,
			},
		});
		const idlePrompt = buildSession({
			overrides: {
				status: SessionStatus.Waiting,
				type: SessionKind.IdlePrompt,
			},
		});
		const running = buildSession({
			overrides: {
				status: SessionStatus.Running,
				type: SessionKind.PermissionPrompt,
			},
		});

		expect(isAwaitingPermission({ session: waiting })).toBe(true);
		expect(isAwaitingPermission({ session: idlePrompt })).toBe(false);
		expect(isAwaitingPermission({ session: running })).toBe(false);
	});
});

describe("getTerminalLabel", () => {
	test("maps TERM_PROGRAM to a readable name", () => {
		const iterm = buildSession({ overrides: { term_program: "iTerm.app" } });
		expect(getTerminalLabel({ session: iterm })).toBe("iTerm2");

		const vscode = buildSession({ overrides: { term_program: "vscode" } });
		expect(getTerminalLabel({ session: vscode })).toBe("VS Code");
	});

	test("falls back to the raw value or a generic label", () => {
		const unknown = buildSession({ overrides: { term_program: "foo-term" } });
		expect(getTerminalLabel({ session: unknown })).toBe("foo-term");

		const empty = buildSession({ overrides: { term_program: "" } });
		expect(getTerminalLabel({ session: empty })).toBe("Terminal");
	});
});

describe("getActivityLabel", () => {
	test("shows the current tool while running", () => {
		const session = buildSession({
			overrides: {
				status: SessionStatus.Running,
				tool: "Bash · cargo build",
			},
		});
		expect(getActivityLabel({ session })).toBe("Bash · cargo build");
	});

	test("falls back to the status label without a tool", () => {
		const session = buildSession({
			overrides: { status: SessionStatus.Running, tool: "" },
		});
		expect(getActivityLabel({ session })).toBe("Working…");
	});

	test("waiting sessions keep the waiting label even with a tool", () => {
		const session = buildSession({
			overrides: {
				status: SessionStatus.Waiting,
				type: SessionKind.PermissionPrompt,
				tool: "Bash · rm -rf node_modules",
			},
		});
		expect(getActivityLabel({ session })).toBe("Waiting for permission");
	});
});

describe("hasUsageLimit", () => {
	test("true when the session carries a limit message", () => {
		const limited = buildSession({
			overrides: { limit_message: "5-hour limit reached" },
		});
		expect(hasUsageLimit({ session: limited })).toBe(true);
		expect(hasUsageLimit({ session: buildSession() })).toBe(false);
	});

	test("limit overrides the activity label", () => {
		const session = buildSession({
			overrides: {
				status: SessionStatus.Running,
				tool: "Bash · cargo build",
				limit_message: "5-hour limit reached",
			},
		});
		expect(getActivityLabel({ session })).toBe("Usage limit reached");
	});
});

describe("getStatusLabel", () => {
	test("waiting on a permission prompt", () => {
		const session = buildSession({
			overrides: {
				status: SessionStatus.Waiting,
				type: SessionKind.PermissionPrompt,
			},
		});
		expect(getStatusLabel({ session })).toBe("Waiting for permission");
	});

	test("waiting on an idle prompt", () => {
		const session = buildSession({
			overrides: {
				status: SessionStatus.Waiting,
				type: SessionKind.IdlePrompt,
			},
		});
		expect(getStatusLabel({ session })).toBe("Idle, waiting for you");
	});

	test("running", () => {
		const session = buildSession({
			overrides: { status: SessionStatus.Running },
		});
		expect(getStatusLabel({ session })).toBe("Working…");
	});

	test("unknown status falls back to idle", () => {
		const session = buildSession({ overrides: { status: "garbage" } });
		expect(getStatusLabel({ session })).toBe("Nothing pending");
	});
});

describe("formatRelativeTime", () => {
	test("empty when there is no timestamp", () => {
		expect(formatRelativeTime({ timestamp: 0, now: 100 })).toBe("");
	});

	test("under 45s reads as now", () => {
		expect(formatRelativeTime({ timestamp: 100, now: 130 })).toBe("now");
	});

	test("minutes", () => {
		expect(formatRelativeTime({ timestamp: 100, now: 100 + 180 })).toBe("3min");
	});

	test("hours", () => {
		expect(formatRelativeTime({ timestamp: 100, now: 100 + 7_200 })).toBe("2h");
	});

	test("days", () => {
		expect(formatRelativeTime({ timestamp: 100, now: 100 + 172_800 })).toBe(
			"2d",
		);
	});

	test("future timestamps clamp to now", () => {
		expect(formatRelativeTime({ timestamp: 200, now: 100 })).toBe("now");
	});
});

describe("formatWorkDuration", () => {
	test("empty without a start timestamp", () => {
		expect(formatWorkDuration({ startedAt: 0, ts: 1_000 })).toBe("");
	});

	test("short sessions round up to one minute", () => {
		expect(formatWorkDuration({ startedAt: 100, ts: 110 })).toBe("1min");
	});

	test("minutes", () => {
		expect(formatWorkDuration({ startedAt: 100, ts: 100 + 720 })).toBe("12min");
	});

	test("hours use a compact decimal", () => {
		expect(formatWorkDuration({ startedAt: 100, ts: 100 + 5_400 })).toBe(
			"1.5h",
		);
	});

	test("a start after the last activity clamps to one minute", () => {
		expect(formatWorkDuration({ startedAt: 500, ts: 100 })).toBe("1min");
	});
});

describe("sortSessions", () => {
	test("waiting sessions come first, then most recently updated", () => {
		const idle = buildSession({
			overrides: { session_id: "idle", status: SessionStatus.Idle, ts: 900 },
		});
		const oldWaiting = buildSession({
			overrides: { session_id: "old", status: SessionStatus.Waiting, ts: 100 },
		});
		const newWaiting = buildSession({
			overrides: { session_id: "new", status: SessionStatus.Waiting, ts: 500 },
		});

		const sorted = sortSessions({ sessions: [idle, oldWaiting, newWaiting] });

		expect(sorted.map((s) => s.session_id)).toEqual(["new", "old", "idle"]);
	});

	test("does not mutate the input", () => {
		const sessions = [
			buildSession({ overrides: { session_id: "a", ts: 1 } }),
			buildSession({
				overrides: { session_id: "b", status: SessionStatus.Waiting, ts: 2 },
			}),
		];
		sortSessions({ sessions });
		expect(sessions.map((s) => s.session_id)).toEqual(["a", "b"]);
	});
});

describe("getFolderName", () => {
	test("returns the last path segment", () => {
		expect(getFolderName({ path: "/Users/me/dev/my-app" })).toBe("my-app");
		expect(getFolderName({ path: "/Users/me/dev/my-app/" })).toBe("my-app");
	});

	test("falls back to the raw path", () => {
		expect(getFolderName({ path: "" })).toBe("");
	});
});

describe("formatTokens", () => {
	test("small counts stay as-is", () => {
		expect(formatTokens({ count: 0 })).toBe("0");
		expect(formatTokens({ count: 950 })).toBe("950");
	});

	test("thousands use k with a compact decimal", () => {
		expect(formatTokens({ count: 1_000 })).toBe("1k");
		expect(formatTokens({ count: 89_400 })).toBe("89.4k");
	});

	test("millions use M", () => {
		expect(formatTokens({ count: 1_234_567 })).toBe("1.2M");
	});
});

describe("getSummary", () => {
	test("counts waiting sessions first", () => {
		const sessions = [
			buildSession({ overrides: { status: SessionStatus.Waiting } }),
			buildSession({ overrides: { status: SessionStatus.Waiting } }),
			buildSession({ overrides: { status: SessionStatus.Running } }),
		];
		expect(getSummary({ sessions })).toBe("2 waiting");
	});

	test("falls back to total count", () => {
		expect(getSummary({ sessions: [buildSession()] })).toBe("1 session");
		expect(getSummary({ sessions: [buildSession(), buildSession()] })).toBe(
			"2 sessions",
		);
	});

	test("empty when there are no sessions", () => {
		expect(getSummary({ sessions: [] })).toBe("");
	});
});

describe("countByStatus", () => {
	test("tallies sessions per status", () => {
		const sessions = [
			buildSession({ overrides: { status: SessionStatus.Waiting } }),
			buildSession({ overrides: { status: SessionStatus.Waiting } }),
			buildSession({ overrides: { status: SessionStatus.Running } }),
			buildSession({ overrides: { status: "mystery" } }),
		];
		expect(countByStatus({ sessions })).toEqual({
			waiting: 2,
			running: 1,
			idle: 1,
		});
	});
});
