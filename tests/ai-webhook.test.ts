import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../src/core/types.js";
import { WebhookAiPrecheckPlugin } from "../src/plugins/webhook-ai-precheck.js";

afterEach(() => vi.restoreAllMocks());

describe("AI webhook fallback", () => {
  it("returns a manual-review result when the service is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
    const plugin = new WebhookAiPrecheckPlugin("http://127.0.0.1:8000/precheck");
    const context = {
      task: {
        id: "T005",
        seasonId: "season-2",
        status: "Published",
        currentVersion: 1,
        config: {
          id: "T005",
          seasonId: "season-2",
          title: "Proposal",
          type: "Contribute",
          difficulty: "Standard",
          description: "Submit a proposal",
          basePoints: 60,
          status: "Published",
          reviewMode: "ai_then_human",
          claimRequired: false,
          revisionAllowed: true,
          limits: {},
          requirements: [],
          submissionFields: ["summary"],
          pluginIds: ["ai_webhook_precheck"]
        }
      },
      submission: {
        id: "sub-test",
        seasonId: "season-2",
        taskId: "T005",
        taskVersion: 1,
        userId: "user-test",
        summary: "A detailed test proposal",
        status: "Submitted",
        createdAt: "2026-08-03 00:00:00",
        updatedAt: "2026-08-03 00:00:00"
      },
      recentSubmissionTexts: []
    } satisfies PluginContext;

    const result = await plugin.run(context);
    expect(result.recommendation).toBe("review");
    expect(result.flags).toContain("ai_service_unavailable");
  });
});
