import { useEffect, useState } from "react";
import { IntegrationsSection } from "@/components/integrations-section";
import { SheetPanel } from "@/components/sheet-panel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/hooks/use-settings";
import { formatShortcutGlyphs, shortcutFromEvent } from "@/lib/shortcut";
import { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface SettingsViewProps {
	settings: AppSettings;
	theme: Theme;
	onTheme: (params: { theme: Theme }) => void;
	onSave: (params: { next: AppSettings }) => Promise<void>;
	onClose: () => void;
}

interface ApplyParams {
	patch: Partial<AppSettings>;
}

interface SectionProps {
	label: string;
	hint?: string;
	children: React.ReactNode;
}

const TERMINALS = ["Warp", "Terminal", "iTerm2", "Ghostty"];

const MIN_STALE_HOURS = 0.5;
const MAX_STALE_HOURS = 24;

function formatHours({ hours }: { hours: number }): string {
	return `${String(hours).replace(".", ",")} h`;
}

function Section({ label, hint, children }: SectionProps) {
	return (
		<div>
			<p className="font-semibold text-sm">{label}</p>
			{hint ? (
				<p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
			) : null}
			<div className="mt-1.5">{children}</div>
		</div>
	);
}

export function SettingsView({
	settings,
	theme,
	onTheme,
	onSave,
	onClose,
}: SettingsViewProps) {
	const [form, setForm] = useState(settings);
	const [recording, setRecording] = useState(false);
	const [error, setError] = useState("");

	function apply({ patch }: ApplyParams) {
		const next = { ...form, ...patch };
		setForm(next);
		onSave({ next }).catch((err) => setError(String(err)));
	}

	useEffect(() => {
		if (!recording) return;
		function onKey(event: KeyboardEvent) {
			event.preventDefault();
			event.stopPropagation();
			const shortcut = shortcutFromEvent({ event });
			if (!shortcut) return;
			setRecording(false);
			apply({ patch: { shortcut } });
		}
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	return (
		<SheetPanel
			title={<span className="font-semibold text-sm">Ajustes</span>}
			action={
				<Button size="xs" variant="ghost-primary" onClick={onClose}>
					OK
				</Button>
			}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-3.5">
				<Section label="Aparência">
					<div className="flex gap-1.5">
						<Button
							size="sm"
							variant={theme === Theme.Light ? "default" : "secondary"}
							className="flex-1"
							onClick={() => onTheme({ theme: Theme.Light })}
						>
							☀ Claro
						</Button>
						<Button
							size="sm"
							variant={theme === Theme.Dark ? "default" : "secondary"}
							className="flex-1"
							onClick={() => onTheme({ theme: Theme.Dark })}
						>
							☾ Escuro
						</Button>
					</div>
				</Section>

				<Section label="Atalho de abrir">
					<Button
						variant="field"
						className={cn(recording && "border-primary")}
						onClick={() => setRecording(!recording)}
					>
						<span className="text-muted-foreground text-xs">
							{recording ? "Pressione as teclas…" : "Clique para gravar"}
						</span>
						<span className="font-mono font-semibold text-primary text-sm">
							{recording
								? "…"
								: formatShortcutGlyphs({ shortcut: form.shortcut })}
						</span>
					</Button>
				</Section>

				<Section
					label="Integrações"
					hint="Instala hooks na configuração de cada agente; valem para novas sessões"
				>
					<IntegrationsSection />
				</Section>

				<Section label="Terminal padrão">
					<div className="flex flex-wrap gap-1.5">
						{TERMINALS.map((terminal) => (
							<Button
								key={terminal}
								size="xs"
								variant={
									form.launcher_terminal === terminal ? "default" : "secondary"
								}
								onClick={() =>
									apply({ patch: { launcher_terminal: terminal } })
								}
							>
								{terminal}
							</Button>
						))}
					</div>
				</Section>

				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="font-semibold text-sm">Notificações</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							Avisar quando uma sessão começa a aguardar
						</p>
					</div>
					<Switch
						checked={form.notifications_enabled}
						onCheckedChange={(checked) =>
							apply({ patch: { notifications_enabled: checked } })
						}
					/>
				</div>

				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="font-semibold text-sm">Ocultar inativas após</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							Sessões paradas somem da lista
						</p>
					</div>
					<div className="flex flex-none items-center overflow-hidden rounded-lg border bg-secondary/50">
						<Button
							size="icon-xs"
							variant="ghost"
							className="rounded-none"
							onClick={() =>
								apply({
									patch: {
										stale_hours: Math.max(
											MIN_STALE_HOURS,
											form.stale_hours - MIN_STALE_HOURS,
										),
									},
								})
							}
						>
							−
						</Button>
						<span className="min-w-11 text-center font-mono text-foreground text-xs tabular-nums">
							{formatHours({ hours: form.stale_hours })}
						</span>
						<Button
							size="icon-xs"
							variant="ghost"
							className="rounded-none"
							onClick={() =>
								apply({
									patch: {
										stale_hours: Math.min(
											MAX_STALE_HOURS,
											form.stale_hours + MIN_STALE_HOURS,
										),
									},
								})
							}
						>
							+
						</Button>
					</div>
				</div>

				{error ? <p className="text-destructive text-xs">{error}</p> : null}
			</div>
		</SheetPanel>
	);
}
