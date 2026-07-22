import { describe, expect, test } from "bun:test";
import { buildMeters, formatResetText, type PlanLimit } from "@/lib/plan-usage";

const NOW = Date.parse("2026-07-22T10:00:00Z");

function iso(offsetMs: number): string {
	return new Date(NOW + offsetMs).toISOString();
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

function buildLimit(overrides: Partial<PlanLimit>): PlanLimit {
	return {
		kind: "session",
		percent: 53,
		resets_at: iso(2 * HOUR),
		scope: null,
		...overrides,
	};
}

describe("buildMeters", () => {
	test("maps limits to pt-BR labels and percentages", () => {
		const limits = [
			buildLimit({ kind: "session", percent: 53 }),
			buildLimit({
				kind: "weekly_all",
				percent: 49,
				resets_at: iso(72 * HOUR),
			}),
			buildLimit({
				kind: "weekly_scoped",
				percent: 43,
				resets_at: iso(72 * HOUR),
				scope: { model: { display_name: "Fable" } },
			}),
		];
		const meters = buildMeters({ usage: { limits }, now: NOW });
		expect(meters.map((m) => m.label)).toEqual([
			"Sessão atual · 5 h",
			"Semana · todos os modelos",
			"Semana · Fable",
		]);
		expect(meters.map((m) => m.percent)).toEqual([53, 49, 43]);
	});

	test("unknown kinds fall back to the raw kind", () => {
		const meters = buildMeters({
			usage: { limits: [buildLimit({ kind: "mystery" })] },
			now: NOW,
		});
		expect(meters[0]?.label).toBe("mystery");
	});
});

describe("formatResetText", () => {
	test("under a day shows clock plus relative time", () => {
		const text = formatResetText({
			resetsAt: iso(2 * HOUR + 41 * MINUTE),
			now: NOW,
		});
		expect(text).toMatch(/^Reinicia \d{2}:\d{2} · em 2 h 41 m$/);
	});

	test("under an hour shows minutes only", () => {
		const text = formatResetText({ resetsAt: iso(30 * MINUTE), now: NOW });
		expect(text).toMatch(/^Reinicia \d{2}:\d{2} · em 30 m$/);
	});

	test("over a day shows the weekday", () => {
		const text = formatResetText({ resetsAt: iso(72 * HOUR), now: NOW });
		expect(text).toMatch(
			/^Reinicia (dom|seg|ter|qua|qui|sex|sáb) \d{2}:\d{2}$/,
		);
	});

	test("empty for past or invalid timestamps", () => {
		expect(formatResetText({ resetsAt: iso(-HOUR), now: NOW })).toBe("");
		expect(formatResetText({ resetsAt: "garbage", now: NOW })).toBe("");
	});
});
