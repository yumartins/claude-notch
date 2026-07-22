import type * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"w-full resize-y rounded-lg border bg-secondary/50 px-2.5 py-2 text-foreground text-xs leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
