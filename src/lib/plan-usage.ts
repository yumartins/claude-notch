export interface PlanLimitScope {
	model: { display_name: string | null } | null;
}

export interface PlanLimit {
	kind: string;
	percent: number;
	resets_at: string;
	scope: PlanLimitScope | null;
}

export interface PlanUsage {
	limits: PlanLimit[];
}

export interface PlanMeter {
	label: string;
	percent: number;
	resetText: string;
}

interface BuildMetersParams {
	usage: PlanUsage;
	now: number;
}

interface FormatResetTextParams {
	resetsAt: string;
	now: number;
}

interface LimitLabelParams {
	limit: PlanLimit;
}

const KIND_LABELS: Record<string, string> = {
	session: "Current session · 5 h",
	weekly_all: "Week · all models",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

function limitLabel({ limit }: LimitLabelParams): string {
	const model = limit.scope?.model?.display_name;
	if (model) return `Week · ${model}`;
	return KIND_LABELS[limit.kind] ?? limit.kind;
}

export function formatResetText({
	resetsAt,
	now,
}: FormatResetTextParams): string {
	const reset = Date.parse(resetsAt);
	if (Number.isNaN(reset) || reset <= now) return "";

	const clock = new Date(reset).toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const minutes = Math.round((reset - now) / MINUTE_MS);
	if (minutes >= DAY_MINUTES)
		return `Resets ${WEEKDAYS[new Date(reset).getDay()]} ${clock}`;

	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	const relative = hours > 0 ? `in ${hours} h ${rest} m` : `in ${rest} m`;
	return `Resets ${clock} · ${relative}`;
}

export function buildMeters({ usage, now }: BuildMetersParams): PlanMeter[] {
	return (usage.limits ?? []).map((limit) => ({
		label: limitLabel({ limit }),
		percent: Math.round(limit.percent ?? 0),
		resetText: formatResetText({ resetsAt: limit.resets_at, now }),
	}));
}
