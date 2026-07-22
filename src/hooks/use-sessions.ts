import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Session } from "@/lib/sessions";

const SESSIONS_EVENT = "sessions";

export function useSessions(): Session[] {
	const [sessions, setSessions] = useState<Session[]>([]);

	useEffect(() => {
		const unlisten = listen<Session[]>(SESSIONS_EVENT, (event) => {
			setSessions(event.payload ?? []);
		});

		return () => {
			unlisten.then((dispose) => dispose());
		};
	}, []);

	return sessions;
}
