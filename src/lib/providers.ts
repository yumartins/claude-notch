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

// Claude and Cursor emit a Claude-format transcript (Cursor's hook synthesizes
// one from its prompt/response events); Codex does not.
const TRANSCRIPT_PROVIDERS = new Set<Provider>([
	Provider.Claude,
	Provider.Cursor,
]);
const TERMINAL_REPLY_PROVIDERS = new Set<Provider>([
	Provider.Claude,
	Provider.Codex,
]);
// Claude enforces its rules natively; Cursor's hook reads the rules the app
// writes and self-approves before prompting. Codex has no rule mechanism.
const PERMISSION_RULE_PROVIDERS = new Set<Provider>([
	Provider.Claude,
	Provider.Cursor,
]);

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
