import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownProps {
	children: string;
	className?: string;
}

const COMPONENTS: Components = {
	p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
	a: ({ children, href }) => (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="text-primary underline underline-offset-2"
		>
			{children}
		</a>
	),
	code: ({ className, children }) =>
		className?.includes("language-") ? (
			<code className={cn("font-mono", className)}>{children}</code>
		) : (
			<code className="rounded bg-muted px-1 py-0.5 font-mono">{children}</code>
		),
	pre: ({ children }) => (
		<pre className="overflow-x-auto rounded bg-muted p-2 font-mono">
			{children}
		</pre>
	),
	ul: ({ children }) => (
		<ul className="list-disc space-y-0.5 pl-4">{children}</ul>
	),
	ol: ({ children }) => (
		<ol className="list-decimal space-y-0.5 pl-4">{children}</ol>
	),
};

export function Markdown({ children, className }: MarkdownProps) {
	return (
		<div className={cn("space-y-1.5 [&>*:first-child]:mt-0", className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
				{children}
			</ReactMarkdown>
		</div>
	);
}
