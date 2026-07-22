import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { PlanUsage } from "@/lib/plan-usage";

/// undefined = loading, null = unavailable (no credentials / endpoint change).
export function usePlanUsage(): PlanUsage | null | undefined {
	const [usage, setUsage] = useState<PlanUsage | null | undefined>(undefined);

	useEffect(() => {
		invoke<PlanUsage>("plan_usage")
			.then(setUsage)
			.catch(() => setUsage(null));
	}, []);

	return usage;
}
