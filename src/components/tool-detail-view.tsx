import { DiffKind, diffLines } from "@/lib/diff";
import { getFolderName } from "@/lib/sessions";
import { type ToolDetail, ToolDetailKind } from "@/lib/tool-detail";
import { cn } from "@/lib/utils";

interface ToolDetailViewProps {
	detail: ToolDetail;
}

const DIFF_LINE_STYLES: Record<DiffKind, string> = {
	[DiffKind.Same]: "text-muted-foreground",
	[DiffKind.Removed]: "bg-destructive/10 text-destructive",
	[DiffKind.Added]: "bg-status-running/10 text-status-running",
};

const DIFF_LINE_MARKERS: Record<DiffKind, string> = {
	[DiffKind.Same]: " ",
	[DiffKind.Removed]: "-",
	[DiffKind.Added]: "+",
};

function DiffView({ detail }: ToolDetailViewProps) {
	const lines = diffLines({
		oldText: detail.oldText,
		newText: detail.newText,
	});
	return (
		<div className="overflow-hidden rounded-md border">
			<p
				className="truncate border-b bg-muted px-2 py-1 font-mono text-xs"
				title={detail.title}
			>
				{getFolderName({ path: detail.title })}
			</p>
			<pre className="max-h-40 overflow-auto py-1 font-mono text-xs leading-4">
				{lines.map((line, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: stateless full re-render, lines can repeat
						key={`${index}-${line.text}`}
						className={cn("px-2 whitespace-pre", DIFF_LINE_STYLES[line.kind])}
					>
						{DIFF_LINE_MARKERS[line.kind]} {line.text}
					</div>
				))}
			</pre>
		</div>
	);
}

function CodeView({ detail }: ToolDetailViewProps) {
	return (
		<pre className="max-h-28 overflow-auto rounded-md border bg-muted px-2 py-1.5 font-mono text-xs leading-4 whitespace-pre-wrap break-all">
			{detail.title}
		</pre>
	);
}

const DETAIL_VIEWS: Record<
	ToolDetailKind,
	({ detail }: ToolDetailViewProps) => React.ReactNode
> = {
	[ToolDetailKind.Command]: CodeView,
	[ToolDetailKind.Diff]: DiffView,
	[ToolDetailKind.Text]: CodeView,
};

export function ToolDetailView({ detail }: ToolDetailViewProps) {
	const View = DETAIL_VIEWS[detail.kind];
	return <View detail={detail} />;
}
