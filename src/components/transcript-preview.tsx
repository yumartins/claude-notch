import { useEffect, useRef } from "react";
import { useTranscript } from "@/hooks/use-transcript";
import { TranscriptRole } from "@/lib/transcript";
import { cn } from "@/lib/utils";

interface TranscriptPreviewProps {
	sessionId: string;
}

const ROLE_LABELS: Record<TranscriptRole, string> = {
	[TranscriptRole.User]: "Você",
	[TranscriptRole.Assistant]: "Claude",
};

export function TranscriptPreview({ sessionId }: TranscriptPreviewProps) {
	const items = useTranscript({ sessionId });
	const scrollRef = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll follows new items
	useEffect(() => {
		const el = scrollRef.current;
		el?.scrollTo({ top: el.scrollHeight });
	}, [items]);

	if (items.length === 0) return null;

	return (
		<div
			ref={scrollRef}
			className="max-h-36 space-y-1.5 overflow-y-auto rounded-md border bg-muted/50 px-2 py-1.5"
		>
			{items.map((item, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: stateless tail view, items shift as transcript grows
				<div key={`${index}-${item.text.slice(0, 24)}`} className="text-xs">
					<span
						className={cn(
							"font-medium",
							item.role === TranscriptRole.User
								? "text-primary"
								: "text-muted-foreground",
						)}
					>
						{ROLE_LABELS[item.role]}
					</span>{" "}
					<span className="text-foreground/80">{item.text}</span>
					{item.tools.map((tool) => (
						<span
							key={tool}
							className="block truncate font-mono text-muted-foreground"
						>
							⚙ {tool}
						</span>
					))}
				</div>
			))}
		</div>
	);
}
