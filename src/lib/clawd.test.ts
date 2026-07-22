import { describe, expect, test } from "bun:test";
import { getClawdArt, sleepingClawd } from "./clawd";
import { SessionStatus } from "./sessions";

describe("getClawdArt", () => {
	test("maps every status to a distinct asset", () => {
		const arts = Object.values(SessionStatus).map((status) =>
			getClawdArt({ status }),
		);

		for (const art of arts) {
			expect(art).toMatch(/\.svg$/);
		}
		expect(new Set(arts).size).toBe(arts.length);
	});

	test("waiting shows the notification clawd", () => {
		expect(getClawdArt({ status: SessionStatus.Waiting })).toContain(
			"clawd-notification",
		);
	});

	test("running shows the typing clawd", () => {
		expect(getClawdArt({ status: SessionStatus.Running })).toContain(
			"clawd-working-typing",
		);
	});

	test("idle shows the idle clawd", () => {
		expect(getClawdArt({ status: SessionStatus.Idle })).toContain(
			"clawd-idle-living",
		);
	});
});

describe("sleepingClawd", () => {
	test("points to the sleeping asset", () => {
		expect(sleepingClawd).toContain("clawd-sleeping");
	});
});
