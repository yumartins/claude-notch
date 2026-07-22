import idleClawd from "@/assets/clawd/clawd-idle-living.svg";
import notificationClawd from "@/assets/clawd/clawd-notification.svg";
import sleepingClawd from "@/assets/clawd/clawd-sleeping.svg";
import typingClawd from "@/assets/clawd/clawd-working-typing.svg";
import { SessionStatus } from "./sessions";

interface GetClawdArtParams {
	status: SessionStatus;
}

const CLAWD_ART: Record<SessionStatus, string> = {
	[SessionStatus.Waiting]: notificationClawd,
	[SessionStatus.Running]: typingClawd,
	[SessionStatus.Idle]: idleClawd,
};

export function getClawdArt({ status }: GetClawdArtParams): string {
	return CLAWD_ART[status];
}

export { sleepingClawd };
