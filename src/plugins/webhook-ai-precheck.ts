import type {
  PluginContext,
  PrecheckPlugin,
  PrecheckResult,
  TaskRecord
} from "../core/types.js";

export class WebhookAiPrecheckPlugin implements PrecheckPlugin {
  id = "ai_webhook_precheck";

  constructor(
    private readonly endpoint: string,
    private readonly token?: string
  ) {}

  supports(task: TaskRecord): boolean {
    return task.config.pluginIds.includes(this.id);
  }

  async run(context: PluginContext): Promise<PrecheckResult> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify({
          version: "1",
          task: context.task.config,
          submission: {
            id: context.submission.id,
            summary: context.submission.summary,
            proofUrl: context.submission.proofUrl,
            attachmentUrl: context.submission.attachmentUrl,
            structuredData: context.submission.structuredData
          },
          recentSubmissionTexts: context.recentSubmissionTexts.slice(0, 20)
        }),
        // The Python service may make a strict request and one compatibility
        // retry. Keep Discord deferred replies alive for both attempts.
        signal: AbortSignal.timeout(75_000)
      });
    } catch (error) {
      return this.unavailableResult(
        error instanceof Error ? error.message : "Network request failed"
      );
    }

    if (!response.ok) {
      return this.unavailableResult(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as Partial<PrecheckResult>;
    return {
      pluginId: this.id,
      score: Number(data.score ?? 50),
      recommendation: data.recommendation ?? "review",
      flags: data.flags ?? [],
      missingItems: data.missingItems ?? [],
      reviewQuestions: data.reviewQuestions ?? [],
      raw: data
    };
  }

  private unavailableResult(reason: string): PrecheckResult {
    return {
      pluginId: this.id,
      score: 50,
      recommendation: "review",
      flags: ["ai_service_unavailable"],
      missingItems: [],
      reviewQuestions: [
        "The AI precheck service failed. Complete the review manually."
      ],
      raw: { reason: reason.slice(0, 300) }
    };
  }
}
