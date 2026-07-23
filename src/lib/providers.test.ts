import { describe, expect, test } from "bun:test";
import {
	getProvider,
	getProviderLabel,
	Provider,
	supportsPermissionRules,
	supportsTerminalReply,
	supportsTranscript,
} from "@/lib/providers";
import type { Session } from "@/lib/sessions";

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		session_id: "s1",
		project: "demo",
		cwd: "/tmp/demo",
		status: "running",
		message: "",
		tool: "",
		tool_name: "",
		tool_input: null,
		type: "",
		tty: "",
		term_program: "",
		last_message: "",
		limit_message: "",
		context_tokens: 0,
		output_tokens: 0,
		provider: Provider.Claude,
		started_at: 0,
		ts: 0,
		...overrides,
	};
}

describe("getProvider", () => {
	test("returns the session provider when known", () => {
		const session = makeSession({ provider: "codex" });
		expect(getProvider({ session })).toBe(Provider.Codex);
	});

	test("falls back to claude for unknown or empty providers", () => {
		expect(getProvider({ session: makeSession({ provider: "" }) })).toBe(
			Provider.Claude,
		);
		expect(getProvider({ session: makeSession({ provider: "grok" }) })).toBe(
			Provider.Claude,
		);
	});
});

describe("getProviderLabel", () => {
	test("labels each provider", () => {
		expect(
			getProviderLabel({ session: makeSession({ provider: "claude" }) }),
		).toBe("Claude Code");
		expect(
			getProviderLabel({ session: makeSession({ provider: "codex" }) }),
		).toBe("Codex");
		expect(
			getProviderLabel({ session: makeSession({ provider: "cursor" }) }),
		).toBe("Cursor");
	});
});

describe("capability gating", () => {
	test("transcript preview is claude-only", () => {
		expect(
			supportsTranscript({ session: makeSession({ provider: "claude" }) }),
		).toBe(true);
		expect(
			supportsTranscript({ session: makeSession({ provider: "codex" }) }),
		).toBe(false);
		expect(
			supportsTranscript({ session: makeSession({ provider: "cursor" }) }),
		).toBe(false);
	});

	test("terminal reply works for terminal-based providers only", () => {
		expect(
			supportsTerminalReply({ session: makeSession({ provider: "claude" }) }),
		).toBe(true);
		expect(
			supportsTerminalReply({ session: makeSession({ provider: "codex" }) }),
		).toBe(true);
		expect(
			supportsTerminalReply({ session: makeSession({ provider: "cursor" }) }),
		).toBe(false);
	});

	test("permission rules are claude-only", () => {
		expect(
			supportsPermissionRules({
				session: makeSession({ provider: "claude" }),
			}),
		).toBe(true);
		expect(
			supportsPermissionRules({ session: makeSession({ provider: "codex" }) }),
		).toBe(false);
	});
});
