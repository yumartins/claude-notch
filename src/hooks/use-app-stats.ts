import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface AppStats {
	memory_mb: number;
	cpu_percent: number;
}

const REFRESH_MS = 5_000;

export function useAppStats() {
	const [stats, setStats] = useState<AppStats | null>(null);
	const [version, setVersion] = useState("");

	useEffect(() => {
		getVersion()
			.then(setVersion)
			.catch(() => {});

		function refresh() {
			invoke<AppStats>("app_stats")
				.then(setStats)
				.catch(() => {});
		}

		refresh();
		const id = setInterval(refresh, REFRESH_MS);
		return () => clearInterval(id);
	}, []);

	return { stats, version };
}
