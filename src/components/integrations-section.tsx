import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS, Provider } from "@/lib/providers";

interface ToggleParams {
	provider: Provider;
}

const PROVIDER_HINTS: Record<Provider, string> = {
	[Provider.Claude]: "Sessions and permission approval in the terminal",
	[Provider.Codex]: "Codex CLI sessions (requires codex_hooks enabled)",
	[Provider.Cursor]: "Sessions and agent command approval",
};

export function IntegrationsSection() {
	const [installed, setInstalled] = useState<Record<string, boolean>>({});
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
	}, []);

	useEffect(refresh, [refresh]);

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
			{Object.values(Provider).map((provider) => (
				<div key={provider} className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<p className="font-medium text-sm">{PROVIDER_LABELS[provider]}</p>
						<p className="mt-0.5 truncate text-muted-foreground text-xs">
							{PROVIDER_HINTS[provider]}
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
			))}
			{error ? <p className="text-destructive text-xs">{error}</p> : null}
		</div>
	);
}
