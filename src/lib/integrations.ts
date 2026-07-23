import { formatRelativeTime } from "@/lib/sessions";

export enum IntegrationHealth {
	NotInstalled = "not_installed",
	Pending = "pending",
	Active = "active",
}

interface HealthParams {
	installed: boolean;
	lastEventTs: number | undefined;
}

interface HealthLabelParams {
	health: IntegrationHealth;
	lastEventTs: number | undefined;
	now: number;
}

export function getIntegrationHealth({
	installed,
	lastEventTs,
}: HealthParams): IntegrationHealth {
	if (!installed) return IntegrationHealth.NotInstalled;
	return lastEventTs && lastEventTs > 0
		? IntegrationHealth.Active
		: IntegrationHealth.Pending;
}

export function getIntegrationHealthLabel({
	health,
	lastEventTs,
	now,
}: HealthLabelParams): string {
	const relative = formatRelativeTime({ timestamp: lastEventTs ?? 0, now });
	const lastEvent = relative === "now" ? "just now" : `${relative} ago`;
	const labels: Record<IntegrationHealth, string> = {
		[IntegrationHealth.NotInstalled]: "",
		[IntegrationHealth.Pending]:
			"No events yet — restart the agent to activate",
		[IntegrationHealth.Active]: `Active · last event ${lastEvent}`,
	};
	return labels[health];
}
