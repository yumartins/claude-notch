import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { SheetPanel } from "@/components/sheet-panel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PickerSheetProps {
	onClose: () => void;
}

interface StartSessionParams {
	path: string;
}

export function PickerSheet({ onClose }: PickerSheetProps) {
	const [recents, setRecents] = useState<string[]>([]);

	useEffect(() => {
		invoke<string[]>("get_recents")
			.then(setRecents)
			.catch(() => {});
	}, []);

	function startSession({ path }: StartSessionParams) {
		invoke("start_session", { path }).catch(console.error);
		onClose();
	}

	async function pickFolder() {
		const path = await openDialog({ directory: true }).catch(() => null);
		if (typeof path !== "string") return;
		startSession({ path });
	}

	return (
		<SheetPanel
			title={<span className="font-semibold text-sm">Iniciar Claude em…</span>}
		>
			<ScrollArea className="min-h-0 flex-1">
				<div className="p-1.5">
					{recents.map((path) => (
						<Button
							key={path}
							variant="ghost"
							title={path}
							className="h-auto w-full justify-start gap-2.5 px-3 py-2.5"
							onClick={() => startSession({ path })}
						>
							<Folder className="size-3.5 flex-none text-primary/60" />
							<span className="truncate font-mono text-foreground text-xs">
								{path}
							</span>
						</Button>
					))}
					<Button
						variant="ghost"
						className="h-auto w-full justify-start gap-2.5 px-3 py-2.5"
						onClick={pickFolder}
					>
						<FolderOpen className="size-3.5 flex-none text-muted-foreground" />
						<span className="text-muted-foreground text-xs">
							Escolher pasta…
						</span>
					</Button>
				</div>
			</ScrollArea>
			<div className="h-px flex-none bg-border" />
			<div className="flex flex-none justify-end px-3 py-2">
				<Button size="xs" variant="ghost" onClick={onClose}>
					Cancelar
				</Button>
			</div>
		</SheetPanel>
	);
}
