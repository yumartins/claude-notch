import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	getIntegrationHealth,
	getIntegrationHealthLabel,
	IntegrationHealth,
} from "@/lib/integrations";
import { PROVIDER_LABELS, Provider } from "@/lib/providers";
import { cn } from "@/lib/utils";

interface ToggleParams {
	provider: Provider;
}

const PROVIDER_HINTS: Record<Provider, string> = {
	[Provider.Claude]: "Sessions and permission approval in the terminal",
	[Provider.Codex]: "Codex CLI sessions (requires codex_hooks enabled)",
	[Provider.Cursor]: "Sessions and agent command approval",
};

const HEALTH_REFRESH_MS = 3_000;

export function IntegrationsSection() {
	const [installed, setInstalled] = useState<Record<string, boolean>>({});
	const [events, setEvents] = useState<Record<string, number>>({});
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");

	const refresh = useCallback(() => {
		for (const provider of Object.values(Provider)) {
			invoke<boolean>("integration_status", { provider })
				.then((ok) =>
					setInstalled((previous) => ({ ...previous, [provider]: ok })),
				)
				.catch(() => {});
		}
		invoke<Record<string, number>>("integration_events")
			.then(setEvents)
			.catch(() => {});
	}, []);

	useEffect(() => {
		refresh();
		const timer = setInterval(refresh, HEALTH_REFRESH_MS);
		return () => clearInterval(timer);
	}, [refresh]);

	async function toggle({ provider }: ToggleParams) {
		const command = installed[provider]
			? "uninstall_integration"
			: "install_integration";
		setBusy(provider);
		setError("");
		try {
			await invoke(command, { provider });
			refresh();
		} catch (err) {
			setError(String(err));
		} finally {
			setBusy("");
		}
	}

	return (
		<div className="space-y-2.5">
			{Object.values(Provider).map((provider) => {
				const health = getIntegrationHealth({
					installed: installed[provider] ?? false,
					lastEventTs: events[provider],
				});
				const isPending = health === IntegrationHealth.Pending;
				const detail =
					health === IntegrationHealth.NotInstalled
						? PROVIDER_HINTS[provider]
						: getIntegrationHealthLabel({
								health,
								lastEventTs: events[provider],
								now: Date.now() / 1000,
							});

				return (
					<div
						key={provider}
						className="flex items-center justify-between gap-3"
					>
						<div className="min-w-0">
							<p className="font-medium text-sm">{PROVIDER_LABELS[provider]}</p>
							<p
								className={cn(
									"mt-0.5 truncate text-xs",
									isPending ? "text-status-waiting" : "text-muted-foreground",
								)}
							>
								{detail}
							</p>
						</div>
						<Button
							size="xs"
							variant={installed[provider] ? "secondary" : "default"}
							disabled={busy === provider}
							onClick={() => toggle({ provider })}
						>
							{installed[provider] ? "Remove" : "Install"}
						</Button>
					</div>
				);
			})}
			{error ? <p className="text-destructive text-xs">{error}</p> : null}
		</div>
	);
}
