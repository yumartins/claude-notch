import type { ReactNode } from "react";

interface SheetPanelProps {
	title: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}

export function SheetPanel({ title, action, children }: SheetPanelProps) {
	return (
		<div className="absolute inset-0 z-10 flex animate-pop flex-col bg-sheet backdrop-blur-2xl motion-reduce:animate-none">
			<div className="flex flex-none items-center justify-between px-3.5 pt-3 pb-2">
				{title}
				{action}
			</div>
			<div className="h-px flex-none bg-border" />
			{children}
		</div>
	);
}
