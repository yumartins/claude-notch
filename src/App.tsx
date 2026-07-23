import { invoke } from "@tauri-apps/api/core";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { PickerSheet } from "@/components/picker-sheet";
import { SessionRow } from "@/components/session-row";
import { SettingsView } from "@/components/settings-view";
import { StatsView } from "@/components/stats-view";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStats } from "@/hooks/use-app-stats";
import { usePermissions } from "@/hooks/use-permissions";
import { useSessions } from "@/hooks/use-sessions";
import { useSettings } from "@/hooks/use-settings";
import { useTheme } from "@/hooks/use-theme";
import { sleepingClawd } from "@/lib/clawd";
import { findRequestForSession } from "@/lib/permissions";
import { countByStatus, sortSessions } from "@/lib/sessions";
import { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

enum Sheet {
	Picker = "picker",
	Settings = "settings",
	Metrics = "metrics",
}

interface ThemeToggleProps {
	theme: Theme;
	onTheme: (params: { theme: Theme }) => void;
}

interface StatusBadgeProps {
	count: number;
	label: string;
	className: string;
}

function quitApp() {
	invoke("quit").catch(() => {});
}

function ThemeToggle({ theme, onTheme }: ThemeToggleProps) {
	const segment = (target: Theme, Icon: typeof Sun, title: string) => (
		<button
			type="button"
			title={title}
			className={cn(
				"flex h-4.5 w-6 items-center justify-center rounded-full transition-colors",
				theme === target
					? "bg-primary text-primary-foreground"
					: "text-muted-foreground/70 hover:text-foreground",
			)}
			onClick={() => onTheme({ theme: target })}
		>
			<Icon className="size-2.5" />
		</button>
	);

	return (
		<div className="flex items-center gap-px rounded-full border bg-secondary p-0.5">
			{segment(Theme.Light, Sun, "Tema claro")}
			{segment(Theme.Dark, Moon, "Tema escuro")}
		</div>
	);
}

function StatusBadge({ count, label, className }: StatusBadgeProps) {
	if (count === 0) return null;
	return (
		<span
			className={cn(
				"rounded-full px-2.5 py-0.5 font-semibold text-xs tabular-nums",
				className,
			)}
		>
			{count} {label}
		</span>
	);
}

function EmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3">
			<span className="relative">
				<span className="absolute inset-0 scale-125 rounded-full bg-primary/15 blur-xl" />
				<img src={sleepingClawd} alt="" className="relative size-20" />
			</span>
			<span className="flex flex-col items-center gap-0.5">
				<span className="font-medium text-foreground/80 text-xs">
					Tudo tranquilo por aqui
				</span>
				<span className="text-muted-foreground text-xs">
					O Clawd avisa quando alguma sessão precisar de você
				</span>
			</span>
		</div>
	);
}

export default function App() {
	const sessions = useSessions();
	const requests = usePermissions();
	const sorted = sortSessions({ sessions });
	const counts = countByStatus({ sessions });
	const { stats, version } = useAppStats();
	const { settings, save } = useSettings();
	const { theme, setTheme } = useTheme();
	const [sheet, setSheet] = useState<Sheet | null>(null);

	const totalLabel =
		sessions.length === 1 ? "1 sessão" : `${sessions.length} sessões`;

	const closeSheet = () => setSheet(null);

	const sheetViews: Record<Sheet, React.ReactNode> = {
		[Sheet.Picker]: <PickerSheet onClose={closeSheet} />,
		[Sheet.Settings]: settings ? (
			<SettingsView
				settings={settings}
				theme={theme}
				onTheme={setTheme}
				onSave={save}
				onClose={closeSheet}
			/>
		) : null,
		[Sheet.Metrics]: <StatsView onClose={closeSheet} />,
	};

	return (
		<main className="relative flex h-full flex-col">
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-primary/10 to-transparent transition-opacity duration-700",
					counts.waiting > 0 ? "opacity-100" : "opacity-0",
				)}
			/>
			<header className="relative flex flex-none items-center justify-between px-3.5 pt-3 pb-2">
				<span className="flex items-center gap-2">
					<span className="size-1.5 rounded-full bg-primary" />
					<h1 className="font-bold text-sm tracking-tight">Claude Notch</h1>
					<span className="text-muted-foreground/70 text-xs tabular-nums">
						{sessions.length > 0 ? totalLabel : ""}
					</span>
				</span>
				<ThemeToggle theme={theme} onTheme={setTheme} />
			</header>

			{sessions.length > 0 ? (
				<div className="flex flex-none gap-1.5 px-3.5 pb-2.5">
					<StatusBadge
						count={counts.waiting}
						label="aguardando"
						className="bg-status-waiting/15 text-status-waiting"
					/>
					<StatusBadge
						count={counts.running}
						label="rodando"
						className="bg-status-running/15 text-status-running"
					/>
					<StatusBadge
						count={counts.idle}
						label="ociosa"
						className="bg-secondary text-muted-foreground"
					/>
				</div>
			) : null}
			<div className="h-px flex-none bg-border" />

			{sorted.length === 0 ? (
				<EmptyState />
			) : (
				<ScrollArea className="min-h-0 flex-1">
					<div className="p-2">
						{sorted.map((session, index) => (
							<SessionRow
								key={session.session_id}
								session={session}
								request={findRequestForSession({
									requests,
									sessionId: session.session_id,
								})}
								index={index}
								onShowUsage={() => setSheet(Sheet.Metrics)}
							/>
						))}
					</div>
				</ScrollArea>
			)}

			<div className="h-px flex-none bg-border" />
			<footer className="flex flex-none items-center justify-between px-3.5 py-2.5">
				<Button
					size="xs"
					variant="ghost-primary"
					className="gap-1.5 text-sm"
					onClick={() => setSheet(Sheet.Picker)}
				>
					<span className="text-base leading-none">+</span> Nova sessão
				</Button>
				<span className="flex items-center gap-1">
					<Button
						size="sm"
						variant="ghost-muted"
						onClick={() => setSheet(Sheet.Metrics)}
					>
						Métricas
					</Button>
					<Button
						size="sm"
						variant="ghost-muted"
						onClick={() => setSheet(Sheet.Settings)}
					>
						Ajustes
					</Button>
					<Button size="sm" variant="ghost-muted" onClick={quitApp}>
						Sair
					</Button>
				</span>
			</footer>
			<div className="h-px flex-none bg-border/60" />
			<div className="flex flex-none items-center justify-between px-3.5 py-1.5 font-mono text-muted-foreground/70 text-xs">
				<span>
					Claude Notch{" "}
					{version ? <span className="opacity-70">v{version}</span> : null}
				</span>
				<span className="flex gap-2 tabular-nums">
					{stats ? <span>{Math.round(stats.memory_mb)} MB</span> : null}
					{stats ? <span className="opacity-50">·</span> : null}
					{stats ? <span>{stats.cpu_percent.toFixed(1)}% CPU</span> : null}
				</span>
			</div>

			{sheet ? sheetViews[sheet] : null}
		</main>
	);
}
