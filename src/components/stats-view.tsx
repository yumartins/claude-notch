import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { SheetPanel } from "@/components/sheet-panel";
import { Button } from "@/components/ui/button";
import { usePlanUsage } from "@/hooks/use-plan-usage";
import { buildMeters, type PlanMeter } from "@/lib/plan-usage";
import { formatTokens } from "@/lib/sessions";
import {
	fillDays,
	formatUsd,
	summarizeUsage,
	type UsageBucket,
	type UsageSummary,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

enum MetricsTab {
	Usage = "usage",
	Cost = "cost",
}

const TAB_LABELS: Record<MetricsTab, string> = {
	[MetricsTab.Usage]: "Uso do plano",
	[MetricsTab.Cost]: "Custo",
};

const WINDOW_DAYS = 7;
const TOP_PROJECTS = 5;
const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

const MODEL_BAR_CLASSES: Record<string, string> = {
	Sonnet: "bg-status-waiting",
	Opus: "bg-primary",
	Haiku: "bg-status-running",
	Fable: "bg-destructive",
};

interface StatsViewProps {
	onClose: () => void;
}

interface StatCardProps {
	label: string;
	value: string;
}

interface SectionLabelProps {
	children: React.ReactNode;
}

function StatCard({ label, value }: StatCardProps) {
	return (
		<div className="flex-1 rounded-xl border bg-card px-3 py-2.5">
			<p className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</p>
			<p className="mt-0.5 font-bold text-foreground text-xl tabular-nums tracking-tight">
				{value}
			</p>
		</div>
	);
}

function SectionLabel({ children }: SectionLabelProps) {
	return (
		<p className="mb-1.5 text-muted-foreground/70 text-xs uppercase tracking-wide">
			{children}
		</p>
	);
}

function modelBarClass({ model }: { model: string }): string {
	return MODEL_BAR_CLASSES[model] ?? "bg-muted-foreground";
}

interface MeterProps {
	meter: PlanMeter;
}

function meterClasses({ percent }: { percent: number }) {
	if (percent >= 90) return { bar: "bg-destructive", pct: "text-destructive" };
	if (percent >= 70) return { bar: "bg-primary", pct: "text-primary" };
	return { bar: "bg-status-waiting", pct: "text-muted-foreground" };
}

function Meter({ meter }: MeterProps) {
	const classes = meterClasses({ percent: meter.percent });
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2">
				<span className="font-semibold text-xs">{meter.label}</span>
				<span
					className={cn(
						"font-mono font-bold text-xs tabular-nums",
						classes.pct,
					)}
				>
					{meter.percent}%
				</span>
			</div>
			<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
				<div
					className={cn("h-full rounded-full", classes.bar)}
					style={{ width: `${Math.min(100, meter.percent)}%` }}
				/>
			</div>
			{meter.resetText ? (
				<p className="mt-1 font-mono text-muted-foreground/70 text-xs">
					{meter.resetText}
				</p>
			) : null}
		</div>
	);
}

function PlanUsageTab() {
	const usage = usePlanUsage();

	if (usage === undefined)
		return (
			<p className="px-3.5 py-3 text-muted-foreground text-xs">Calculando…</p>
		);
	if (usage === null)
		return (
			<p className="px-3.5 py-3 text-muted-foreground text-xs">
				Uso do plano indisponível — faça login no Claude Code
			</p>
		);

	const meters = buildMeters({ usage, now: Date.now() });
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-3.5">
			{meters.map((meter) => (
				<Meter key={meter.label} meter={meter} />
			))}
			<p className="border-t pt-3 text-muted-foreground/70 text-xs leading-relaxed">
				Espelha o{" "}
				<span className="font-mono text-muted-foreground">/usage</span> do
				Claude Code. Limites usam janela deslizante e reiniciam sozinhos.
			</p>
		</div>
	);
}

function utcToday(): string {
	return new Date().toISOString().slice(0, 10);
}

function weekdayLabel({ day }: { day: string }): string {
	return WEEKDAY_LABELS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? "";
}

function CostTab() {
	const [summary, setSummary] = useState<UsageSummary | null>(null);
	const [today] = useState(utcToday);

	useEffect(() => {
		invoke<UsageBucket[]>("usage_stats", { days: WINDOW_DAYS })
			.then((buckets) => setSummary(summarizeUsage({ buckets, today })))
			.catch(() => setSummary(null));
	}, [today]);

	const days = summary
		? fillDays({ days: summary.days, today, count: WINDOW_DAYS })
		: [];
	const peak = Math.max(...days.map((d) => d.costUsd), 0.01);
	const modelTotal = summary
		? Math.max(
				summary.models.reduce((sum, model) => sum + model.costUsd, 0),
				0.01,
			)
		: 0.01;

	return summary === null ? (
		<p className="px-3.5 py-3 text-muted-foreground text-xs">Calculando…</p>
	) : (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-3.5">
			<div className="flex gap-2">
				<StatCard
					label="Hoje"
					value={formatUsd({ value: summary.todayCostUsd })}
				/>
				<StatCard
					label="7 dias"
					value={formatUsd({ value: summary.totalCostUsd })}
				/>
			</div>

			<div>
				<SectionLabel>Custo por dia</SectionLabel>
				<div className="flex h-20 items-end gap-1.5">
					{days.map((stat) => (
						<div
							key={stat.day}
							className="flex h-full flex-1 flex-col items-center justify-end gap-1"
							title={`${stat.day} · ${formatUsd({ value: stat.costUsd })}`}
						>
							<span
								className={cn(
									"font-mono text-xs tabular-nums",
									stat.day === today
										? "text-foreground"
										: "text-muted-foreground/70",
								)}
							>
								{stat.costUsd.toFixed(1).replace(".", ",")}
							</span>
							<div
								className={cn(
									"w-full max-w-6 rounded-t-[4px]",
									stat.day === today ? "bg-primary" : "bg-status-waiting/25",
								)}
								style={{
									height: `${Math.max((stat.costUsd / peak) * 75, 4)}%`,
								}}
							/>
						</div>
					))}
				</div>
				<div className="mt-1 flex gap-1.5">
					{days.map((stat) => (
						<span
							key={stat.day}
							className="flex-1 text-center text-muted-foreground text-xs"
						>
							{weekdayLabel({ day: stat.day })}
						</span>
					))}
				</div>
			</div>

			<div>
				<SectionLabel>Por projeto</SectionLabel>
				<div className="space-y-2.5">
					{summary.projects.slice(0, TOP_PROJECTS).map((project) => (
						<div key={project.project}>
							<div className="flex items-baseline justify-between gap-2">
								<span className="truncate font-semibold text-xs">
									{project.project}
								</span>
								<span className="flex-none font-mono font-semibold text-primary text-xs tabular-nums">
									{formatUsd({ value: project.costUsd })}
								</span>
							</div>
							<div className="mt-1 flex items-center gap-2">
								<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
									<div
										className="h-full rounded-full bg-primary/75"
										style={{
											width: `${Math.round(
												(project.costUsd /
													Math.max(summary.projects[0].costUsd, 0.01)) *
													100,
											)}%`,
										}}
									/>
								</div>
								<span className="min-w-14 flex-none text-right font-mono text-muted-foreground text-xs tabular-nums">
									{formatTokens({ count: project.outputTokens })} tok
								</span>
							</div>
						</div>
					))}
					{summary.projects.length === 0 ? (
						<p className="text-muted-foreground text-xs">Sem uso registrado</p>
					) : null}
				</div>
			</div>

			{summary.models.length > 0 ? (
				<div>
					<SectionLabel>Por modelo</SectionLabel>
					<div className="flex h-2 gap-px overflow-hidden rounded-full">
						{summary.models.map((model) => (
							<div
								key={model.model}
								className={cn("h-full", modelBarClass({ model: model.model }))}
								style={{
									width: `${(model.costUsd / modelTotal) * 100}%`,
								}}
							/>
						))}
					</div>
					<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
						{summary.models.map((model) => (
							<span
								key={model.model}
								className="flex items-center gap-1.5 text-xs"
							>
								<span
									className={cn(
										"size-2 rounded-xs",
										modelBarClass({ model: model.model }),
									)}
								/>
								<span className="text-muted-foreground">{model.model}</span>
								<span className="font-mono text-muted-foreground/70 tabular-nums">
									{formatUsd({ value: model.costUsd })}
								</span>
							</span>
						))}
					</div>
				</div>
			) : null}

			<p className="text-muted-foreground/70 text-xs">
				Estimativa por preço de API, sem descontos de plano
			</p>
		</div>
	);
}

export function StatsView({ onClose }: StatsViewProps) {
	const [tab, setTab] = useState(MetricsTab.Usage);

	return (
		<SheetPanel
			title={
				<span className="flex items-center gap-1">
					{Object.values(MetricsTab).map((value) => (
						<Button
							key={value}
							size="xs"
							variant={tab === value ? "secondary" : "ghost"}
							className={cn(
								"font-semibold",
								tab !== value && "text-muted-foreground",
							)}
							onClick={() => setTab(value)}
						>
							{TAB_LABELS[value]}
						</Button>
					))}
				</span>
			}
			action={
				<Button
					size="xs"
					variant="ghost"
					className="text-primary"
					onClick={onClose}
				>
					OK
				</Button>
			}
		>
			{tab === MetricsTab.Usage ? <PlanUsageTab /> : <CostTab />}
		</SheetPanel>
	);
}
