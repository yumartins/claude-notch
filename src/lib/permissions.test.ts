import { describe, expect, test } from "bun:test";
import {
	findRequestForSession,
	getRequestToolSummary,
	PermissionDecision,
	type PermissionRequest,
} from "@/lib/permissions";

function makeRequest(
	overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
	return {
		request_id: "1",
		provider: "claude",
		session_id: "s1",
		tool_name: "Bash",
		tool_input: { command: "cargo build" },
		cwd: "/tmp/demo",
		project: "demo",
		ts: 100,
		...overrides,
	};
}

describe("findRequestForSession", () => {
	test("returns the pending request for the session", () => {
		const requests = [
			makeRequest({ request_id: "1", session_id: "a" }),
			makeRequest({ request_id: "2", session_id: "b" }),
		];
		expect(
			findRequestForSession({ requests, sessionId: "b" })?.request_id,
		).toBe("2");
	});

	test("returns the oldest request when a session has several", () => {
		const requests = [
			makeRequest({ request_id: "2", session_id: "a", ts: 200 }),
			makeRequest({ request_id: "1", session_id: "a", ts: 100 }),
		];
		expect(
			findRequestForSession({ requests, sessionId: "a" })?.request_id,
		).toBe("1");
	});

	test("undefined when nothing is pending", () => {
		expect(
			findRequestForSession({ requests: [], sessionId: "a" }),
		).toBeUndefined();
	});
});

describe("getRequestToolSummary", () => {
	test("tool name with command detail", () => {
		expect(getRequestToolSummary({ request: makeRequest() })).toBe(
			"Bash · cargo build",
		);
	});

	test("tool name with file path detail", () => {
		const request = makeRequest({
			tool_name: "Edit",
			tool_input: { file_path: "/tmp/a.ts" },
		});
		expect(getRequestToolSummary({ request })).toBe("Edit · /tmp/a.ts");
	});

	test("tool name alone without details", () => {
		const request = makeRequest({ tool_name: "WebFetch", tool_input: null });
		expect(getRequestToolSummary({ request })).toBe("WebFetch");
	});
});

describe("PermissionDecision", () => {
	test("wire values match the socket protocol", () => {
		expect(String(PermissionDecision.Allow)).toBe("allow");
		expect(String(PermissionDecision.Deny)).toBe("deny");
		expect(String(PermissionDecision.Passthrough)).toBe("passthrough");
	});
});
