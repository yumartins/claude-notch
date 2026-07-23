import type { Session } from "@/lib/sessions";

export enum Provider {
	Claude = "claude",
	Codex = "codex",
	Cursor = "cursor",
}

interface SessionParams {
	session: Session;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
	[Provider.Claude]: "Claude Code",
	[Provider.Codex]: "Codex",
	[Provider.Cursor]: "Cursor",
};

const KNOWN_PROVIDERS = new Set<string>(Object.values(Provider));

// Transcript parsing and terminal keystrokes are Claude-format/TUI specific;
// Codex still runs in a terminal, Cursor lives inside the editor.
const TRANSCRIPT_PROVIDERS = new Set<Provider>([Provider.Claude]);
const TERMINAL_REPLY_PROVIDERS = new Set<Provider>([
	Provider.Claude,
	Provider.Codex,
]);
const PERMISSION_RULE_PROVIDERS = new Set<Provider>([Provider.Claude]);

export function getProvider({ session }: SessionParams): Provider {
	return KNOWN_PROVIDERS.has(session.provider)
		? (session.provider as Provider)
		: Provider.Claude;
}

export function getProviderLabel({ session }: SessionParams): string {
	return PROVIDER_LABELS[getProvider({ session })];
}

export function supportsTranscript({ session }: SessionParams): boolean {
	return TRANSCRIPT_PROVIDERS.has(getProvider({ session }));
}

export function supportsTerminalReply({ session }: SessionParams): boolean {
	return TERMINAL_REPLY_PROVIDERS.has(getProvider({ session }));
}

export function supportsPermissionRules({ session }: SessionParams): boolean {
	return PERMISSION_RULE_PROVIDERS.has(getProvider({ session }));
}
