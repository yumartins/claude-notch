import { describe, expect, test } from "bun:test";
import {
	bucketCostUsd,
	fillDays,
	formatUsd,
	summarizeUsage,
	type UsageBucket,
} from "@/lib/usage";

function bucket(overrides: Partial<UsageBucket>): UsageBucket {
	return {
		day: "2026-07-21",
		project: "notch",
		model: "claude-sonnet-5",
		input_tokens: 0,
		output_tokens: 0,
		cache_read_tokens: 0,
		cache_creation_tokens: 0,
		...overrides,
	};
}

describe("bucketCostUsd", () => {
	test("prices sonnet tokens per MTok", () => {
		const cost = bucketCostUsd({
			bucket: bucket({
				input_tokens: 1_000_000,
				output_tokens: 1_000_000,
				cache_read_tokens: 1_000_000,
				cache_creation_tokens: 1_000_000,
			}),
		});
		expect(cost).toBeCloseTo(3 + 15 + 0.3 + 3.75, 5);
	});

	test("fable is priced as the top tier", () => {
		const cost = bucketCostUsd({
			bucket: bucket({
				model: "claude-fable-5",
				input_tokens: 1_000_000,
				output_tokens: 1_000_000,
			}),
		});
		expect(cost).toBeCloseTo(10 + 50, 5);
	});

	test("unknown models fall back to fable pricing", () => {
		const cost = bucketCostUsd({
			bucket: bucket({ model: "claude-mystery-9", output_tokens: 1_000_000 }),
		});
		expect(cost).toBeCloseTo(50, 5);
	});
});

describe("summarizeUsage", () => {
	const buckets: UsageBucket[] = [
		bucket({ day: "2026-07-20", project: "a", output_tokens: 1_000_000 }),
		bucket({ day: "2026-07-21", project: "a", output_tokens: 2_000_000 }),
		bucket({ day: "2026-07-21", project: "b", output_tokens: 1_000_000 }),
	];

	test("aggregates cost per day and per project", () => {
		const summary = summarizeUsage({ buckets, today: "2026-07-21" });
		expect(summary.days).toEqual([
			{ day: "2026-07-20", costUsd: 15, outputTokens: 1_000_000 },
			{ day: "2026-07-21", costUsd: 45, outputTokens: 3_000_000 },
		]);
		expect(summary.projects[0]).toEqual({
			project: "a",
			costUsd: 45,
			outputTokens: 3_000_000,
		});
		expect(summary.todayCostUsd).toBeCloseTo(45, 5);
		expect(summary.totalCostUsd).toBeCloseTo(60, 5);
	});

	test("projects are sorted by cost descending", () => {
		const summary = summarizeUsage({ buckets, today: "2026-07-21" });
		expect(summary.projects.map((p) => p.project)).toEqual(["a", "b"]);
	});

	test("aggregates cost per model with friendly labels", () => {
		const summary = summarizeUsage({
			buckets: [
				bucket({ model: "claude-sonnet-5", output_tokens: 1_000_000 }),
				bucket({ model: "claude-haiku-4-5", output_tokens: 1_000_000 }),
				bucket({ model: "claude-sonnet-5", output_tokens: 1_000_000 }),
			],
			today: "2026-07-21",
		});
		expect(summary.models).toEqual([
			{ model: "Sonnet", costUsd: 30, outputTokens: 2_000_000 },
			{ model: "Haiku", costUsd: 5, outputTokens: 1_000_000 },
		]);
	});
});

describe("fillDays", () => {
	test("returns a continuous window ending today, zero-filling gaps", () => {
		const days = [
			{ day: "2026-07-19", costUsd: 2, outputTokens: 10 },
			{ day: "2026-07-21", costUsd: 5, outputTokens: 20 },
		];
		const filled = fillDays({ days, today: "2026-07-21", count: 4 });
		expect(filled.map((d) => d.day)).toEqual([
			"2026-07-18",
			"2026-07-19",
			"2026-07-20",
			"2026-07-21",
		]);
		expect(filled[1]?.costUsd).toBe(2);
		expect(filled[2]?.costUsd).toBe(0);
	});
});

describe("formatUsd", () => {
	test("formats with pt-BR decimals", () => {
		expect(formatUsd({ value: 12.345 })).toBe("US$ 12,35");
		expect(formatUsd({ value: 0 })).toBe("US$ 0,00");
	});
});
