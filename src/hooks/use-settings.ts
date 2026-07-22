import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface AppSettings {
	shortcut: string;
	launcher_terminal: string;
	notifications_enabled: boolean;
	stale_hours: number;
}

interface SaveParams {
	next: AppSettings;
}

export function useSettings() {
	const [settings, setSettings] = useState<AppSettings | null>(null);

	useEffect(() => {
		invoke<AppSettings>("get_settings")
			.then(setSettings)
			.catch(() => {});
	}, []);

	async function save({ next }: SaveParams) {
		await invoke("set_settings", { settings: next });
		setSettings(next);
	}

	return { settings, save };
}
