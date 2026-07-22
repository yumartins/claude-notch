import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { parseTranscriptTail, type TranscriptItem } from "@/lib/transcript";

const POLL_MS = 2_500;
const ITEM_LIMIT = 8;

interface UseTranscriptParams {
	sessionId: string;
}

export function useTranscript({
	sessionId,
}: UseTranscriptParams): TranscriptItem[] {
	const [items, setItems] = useState<TranscriptItem[]>([]);

	useEffect(() => {
		let alive = true;

		async function refresh() {
			try {
				const text = await invoke<string>("read_transcript_tail", {
					sessionId,
				});
				alive && setItems(parseTranscriptTail({ text, limit: ITEM_LIMIT }));
			} catch {
				alive && setItems([]);
			}
		}

		refresh();
		const timer = setInterval(refresh, POLL_MS);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [sessionId]);

	return items;
}
