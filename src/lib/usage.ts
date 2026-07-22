export interface UsageBucket {
	day: string;
	project: string;
	model: string;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_creation_tokens: number;
}

export interface DayStat {
	day: string;
	costUsd: number;
	outputTokens: number;
}

export interface ProjectStat {
	project: string;
	costUsd: number;
	outputTokens: number;
}

export interface ModelStat {
	model: string;
	costUsd: number;
	outputTokens: number;
}

export interface UsageSummary {
	days: DayStat[];
	projects: ProjectStat[];
	models: ModelStat[];
	todayCostUsd: number;
	totalCostUsd: number;
}

interface ModelPricing {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

interface BucketCostParams {
	bucket: UsageBucket;
}

interface SummarizeUsageParams {
	buckets: UsageBucket[];
	today: string;
}

interface FormatUsdParams {
	value: number;
}

/// USD per MTok, keyed by substring of the model id (prices as of Jul 2026).
const PRICING: Record<string, ModelPricing> = {
	haiku: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
	sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	opus: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
	fable: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

const FALLBACK_PRICING = PRICING.fable;
const MTOK = 1_000_000;

const MODEL_LABELS: Record<string, string> = {
	haiku: "Haiku",
	sonnet: "Sonnet",
	opus: "Opus",
	fable: "Fable",
};

export function modelLabel({ model }: { model: string }): string {
	const match = Object.keys(MODEL_LABELS).find((key) => model.includes(key));
	return match ? MODEL_LABELS[match] : model;
}

function pricingFor({ model }: { model: string }): ModelPricing {
	const match = Object.keys(PRICING).find((key) => model.includes(key));
	return match ? PRICING[match] : FALLBACK_PRICING;
}

export function bucketCostUsd({ bucket }: BucketCostParams): number {
	const price = pricingFor({ model: bucket.model });
	return (
		(bucket.input_tokens * price.input +
			bucket.output_tokens * price.output +
			bucket.cache_read_tokens * price.cacheRead +
			bucket.cache_creation_tokens * price.cacheWrite) /
		MTOK
	);
}

function accumulate<Key extends string>(
	map: Map<Key, { costUsd: number; outputTokens: number }>,
	key: Key,
	bucket: UsageBucket,
) {
	const entry = map.get(key) ?? { costUsd: 0, outputTokens: 0 };
	entry.costUsd += bucketCostUsd({ bucket });
	entry.outputTokens += bucket.output_tokens;
	map.set(key, entry);
}

export function summarizeUsage({
	buckets,
	today,
}: SummarizeUsageParams): UsageSummary {
	const byDay = new Map<string, { costUsd: number; outputTokens: number }>();
	const byProject = new Map<
		string,
		{ costUsd: number; outputTokens: number }
	>();
	const byModel = new Map<string, { costUsd: number; outputTokens: number }>();
	for (const bucket of buckets) {
		accumulate(byDay, bucket.day, bucket);
		accumulate(byProject, bucket.project || "—", bucket);
		accumulate(byModel, modelLabel({ model: bucket.model }), bucket);
	}

	const days: DayStat[] = [...byDay.entries()]
		.map(([day, stat]) => ({ day, ...stat }))
		.sort((a, b) => a.day.localeCompare(b.day));
	const projects: ProjectStat[] = [...byProject.entries()]
		.map(([project, stat]) => ({ project, ...stat }))
		.sort((a, b) => b.costUsd - a.costUsd);
	const models: ModelStat[] = [...byModel.entries()]
		.map(([model, stat]) => ({ model, ...stat }))
		.sort((a, b) => b.costUsd - a.costUsd);

	return {
		days,
		projects,
		models,
		todayCostUsd: byDay.get(today)?.costUsd ?? 0,
		totalCostUsd: days.reduce((sum, day) => sum + day.costUsd, 0),
	};
}

interface FillDaysParams {
	days: DayStat[];
	today: string;
	count: number;
}

export function fillDays({ days, today, count }: FillDaysParams): DayStat[] {
	const byDay = new Map(days.map((stat) => [stat.day, stat]));
	const end = new Date(`${today}T00:00:00Z`).getTime();
	return Array.from({ length: count }, (_, index) => {
		const day = new Date(end - (count - 1 - index) * 86_400_000)
			.toISOString()
			.slice(0, 10);
		return byDay.get(day) ?? { day, costUsd: 0, outputTokens: 0 };
	});
}

export function formatUsd({ value }: FormatUsdParams): string {
	return `US$ ${value.toFixed(2).replace(".", ",")}`;
}
