import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RunHookParams {
	script: string;
	args?: string[];
	payload: Record<string, unknown>;
	home: string;
}

interface HookResult {
	exitCode: number;
	stdout: string;
}

interface FakeAppParams {
	home: string;
	decision: string;
	onRequest?: (request: Record<string, unknown>) => void;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function makeHome(): string {
	const home = mkdtempSync(join(tmpdir(), "notch-hooks-"));
	cleanups.push(() => rmSync(home, { recursive: true, force: true }));
	return home;
}

async function runHook({
	script,
	args = [],
	payload,
	home,
}: RunHookParams): Promise<HookResult> {
	const proc = Bun.spawn({
		cmd: ["python3", join(import.meta.dir, script), ...args],
		env: { ...process.env, HOME: home },
		stdin: new TextEncoder().encode(JSON.stringify(payload)),
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await proc.stdout.text();
	const exitCode = await proc.exited;
	return { exitCode, stdout };
}

async function readStatus({
	home,
	file,
}: {
	home: string;
	file: string;
}): Promise<Record<string, unknown>> {
	return await Bun.file(join(home, file)).json();
}

function startFakeApp({ home, decision, onRequest }: FakeAppParams) {
	const dir = join(home, ".claude-notch");
	mkdtempSync(join(tmpdir(), "unused-")); // ensure tmp perms are sane
	Bun.spawnSync({ cmd: ["mkdir", "-p", dir] });
	const server = Bun.listen({
		unix: join(dir, "notch.sock"),
		socket: {
			data(socket, buffer) {
				const request = JSON.parse(buffer.toString().split("\n")[0] ?? "{}");
				onRequest?.(request);
				socket.write(`${JSON.stringify({ decision })}\n`);
			},
		},
	});
	cleanups.push(() => server.stop(true));
}

describe("claude-status.py", () => {
	test("stamps provider and preserves started_at across writes", async () => {
		const home = makeHome();
		const payload = { session_id: "s1", cwd: "/tmp/demo" };

		await runHook({
			script: "claude-status.py",
			args: ["running"],
			payload,
			home,
		});
		const first = await readStatus({ home, file: ".claude/status/s1.json" });
		expect(first.provider).toBe("claude");
		expect(first.status).toBe("running");
		expect(first.started_at as number).toBeGreaterThan(0);

		await runHook({
			script: "claude-status.py",
			args: ["waiting"],
			payload: { ...payload, notification_type: "permission_prompt" },
			home,
		});
		const second = await readStatus({ home, file: ".claude/status/s1.json" });
		expect(second.status).toBe("waiting");
		expect(second.started_at).toBe(first.started_at);
	});
});

describe("codex-status.py", () => {
	test("maps the turn lifecycle onto the status schema", async () => {
		const home = makeHome();
		const base = { session_id: "c1", cwd: "/tmp/demo" };
		const file = ".claude-notch/status/codex-c1.json";

		await runHook({
			script: "codex-status.py",
			payload: { ...base, hook_event_name: "SessionStart" },
			home,
		});
		expect((await readStatus({ home, file })).status).toBe("idle");

		await runHook({
			script: "codex-status.py",
			payload: {
				...base,
				hook_event_name: "PreToolUse",
				tool_name: "Bash",
				tool_input: { command: "cargo test" },
			},
			home,
		});
		const running = await readStatus({ home, file });
		expect(running.status).toBe("running");
		expect(running.provider).toBe("codex");
		expect(running.tool).toBe("Bash · cargo test");

		await runHook({
			script: "codex-status.py",
			payload: {
				...base,
				hook_event_name: "Stop",
				last_assistant_message: "Feito! Testes passando.",
			},
			home,
		});
		const waiting = await readStatus({ home, file });
		expect(waiting.status).toBe("waiting");
		expect(waiting.type).toBe("idle_prompt");
		expect(waiting.last_message).toBe("Feito! Testes passando.");
		expect(waiting.started_at).toBe(running.started_at);
	});
});

describe("cursor-hook.py", () => {
	const base = {
		conversation_id: "v1",
		workspace_roots: ["/tmp/demo"],
	};
	const file = ".claude-notch/status/cursor-v1.json";

	test("records prompts, edits and turn end", async () => {
		const home = makeHome();

		await runHook({
			script: "cursor-hook.py",
			payload: { ...base, hook_event_name: "beforeSubmitPrompt", prompt: "x" },
			home,
		});
		const prompted = await readStatus({ home, file });
		expect(prompted.status).toBe("running");
		expect(prompted.provider).toBe("cursor");
		expect(prompted.project).toBe("demo");
		expect(prompted.term_program).toBe("cursor");

		await runHook({
			script: "cursor-hook.py",
			payload: {
				...base,
				hook_event_name: "afterFileEdit",
				file_path: "/tmp/demo/a.ts",
			},
			home,
		});
		expect((await readStatus({ home, file })).tool).toBe(
			"Edit · /tmp/demo/a.ts",
		);

		await runHook({
			script: "cursor-hook.py",
			payload: { ...base, hook_event_name: "stop", status: "completed" },
			home,
		});
		const stopped = await readStatus({ home, file });
		expect(stopped.status).toBe("waiting");
		expect(stopped.type).toBe("idle_prompt");
	});

	test("shell gating forwards the app decision", async () => {
		const home = makeHome();
		let seen: Record<string, unknown> = {};
		startFakeApp({ home, decision: "allow", onRequest: (r) => (seen = r) });

		const result = await runHook({
			script: "cursor-hook.py",
			payload: {
				...base,
				hook_event_name: "beforeShellExecution",
				command: "git push",
			},
			home,
		});

		expect(JSON.parse(result.stdout)).toEqual({ permission: "allow" });
		expect(seen.kind).toBe("permission_request");
		expect(seen.provider).toBe("cursor");
		expect(seen.session_id).toBe("cursor-v1");
		expect(seen.tool_name).toBe("Shell");
		expect((seen.tool_input as Record<string, unknown>).command).toBe(
			"git push",
		);
		expect((await readStatus({ home, file })).status).toBe("running");
	});

	test("denials also flow back to Cursor", async () => {
		const home = makeHome();
		startFakeApp({ home, decision: "deny" });

		const result = await runHook({
			script: "cursor-hook.py",
			payload: {
				...base,
				hook_event_name: "beforeShellExecution",
				command: "rm -rf /",
			},
			home,
		});

		expect(JSON.parse(result.stdout)).toEqual({ permission: "deny" });
	});

	test("passthrough turns into ask so Cursor prompts in the editor", async () => {
		const home = makeHome();
		startFakeApp({ home, decision: "passthrough" });

		const result = await runHook({
			script: "cursor-hook.py",
			payload: {
				...base,
				hook_event_name: "beforeMCPExecution",
				tool_name: "browser_navigate",
			},
			home,
		});

		expect(JSON.parse(result.stdout)).toEqual({ permission: "ask" });
		expect((await readStatus({ home, file })).status).toBe("waiting");
	});

	test("fails open without the app", async () => {
		const home = makeHome();

		const result = await runHook({
			script: "cursor-hook.py",
			payload: {
				...base,
				hook_event_name: "beforeShellExecution",
				command: "git status",
			},
			home,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
		const status = await readStatus({ home, file });
		expect(status.status).toBe("running");
		expect(status.tool).toBe("Shell · git status");
	});
});

describe("claude-permission.py", () => {
	const payload = {
		session_id: "s9",
		cwd: "/tmp/demo",
		tool_name: "Bash",
		tool_input: { command: "bun test" },
	};

	test("forwards allow decisions in the PermissionRequest format", async () => {
		const home = makeHome();
		startFakeApp({ home, decision: "allow" });

		const result = await runHook({
			script: "claude-permission.py",
			payload,
			home,
		});

		expect(JSON.parse(result.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PermissionRequest",
				decision: { behavior: "allow" },
			},
		});
		const status = await readStatus({ home, file: ".claude/status/s9.json" });
		expect(status.status).toBe("running");
	});

	test("passthrough stays silent so the terminal prompt appears", async () => {
		const home = makeHome();
		startFakeApp({ home, decision: "passthrough" });

		const result = await runHook({
			script: "claude-permission.py",
			payload,
			home,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
		const status = await readStatus({ home, file: ".claude/status/s9.json" });
		expect(status.status).toBe("waiting");
		expect(status.type).toBe("permission_prompt");
	});

	test("fails open without the app", async () => {
		const home = makeHome();

		const result = await runHook({
			script: "claude-permission.py",
			payload,
			home,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("");
	});
});
