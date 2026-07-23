import { describe, expect, test } from "bun:test";
import {
	getIntegrationHealth,
	getIntegrationHealthLabel,
	IntegrationHealth,
} from "@/lib/integrations";

describe("getIntegrationHealth", () => {
	test("not installed regardless of events", () => {
		expect(getIntegrationHealth({ installed: false, lastEventTs: 123 })).toBe(
			IntegrationHealth.NotInstalled,
		);
	});

	test("installed but no events is pending (agent not restarted)", () => {
		expect(
			getIntegrationHealth({ installed: true, lastEventTs: undefined }),
		).toBe(IntegrationHealth.Pending);
		expect(getIntegrationHealth({ installed: true, lastEventTs: 0 })).toBe(
			IntegrationHealth.Pending,
		);
	});

	test("installed with a seen event is active", () => {
		expect(getIntegrationHealth({ installed: true, lastEventTs: 100 })).toBe(
			IntegrationHealth.Active,
		);
	});
});

describe("getIntegrationHealthLabel", () => {
	test("pending prompts the user to restart", () => {
		expect(
			getIntegrationHealthLabel({
				health: IntegrationHealth.Pending,
				lastEventTs: undefined,
				now: 1000,
			}),
		).toContain("restart the agent");
	});

	test("active reports how long ago the last event was", () => {
		expect(
			getIntegrationHealthLabel({
				health: IntegrationHealth.Active,
				lastEventTs: 1000 - 300,
				now: 1000,
			}),
		).toBe("Active · last event 5min ago");
	});

	test("active reads 'just now' for a fresh event", () => {
		expect(
			getIntegrationHealthLabel({
				health: IntegrationHealth.Active,
				lastEventTs: 1000,
				now: 1000,
			}),
		).toBe("Active · last event just now");
	});
});
