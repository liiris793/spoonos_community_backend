import { AppError } from "../core/errors.js";

export type ActivityMessageInput = {
  messageId: string;
  userId: string;
  channelId: string;
  content: string;
  createdAtUtc: string;
  replyToMessageId?: string;
};

export type ActivityMessageDecision = {
  messageId: string;
  ruleStatus: "pass" | "fail";
  ruleFlags: string[];
  aiStatus: "valid" | "invalid" | "uncertain" | "skipped";
  relevanceScore?: number;
  qualityScore?: number;
  reason: string;
};

export type ActivityUserPrecheck = {
  userId: string;
  candidateMessages: number;
  rulePassedMessages: number;
  aiValidMessages: number;
  suggestedPoints: number;
  recommendation: "pass" | "review" | "revision";
  flags: string[];
  reviewQuestions: string[];
  messages: ActivityMessageDecision[];
};

export type ActivityPrecheckResponse = {
  activityDate: string;
  users: ActivityUserPrecheck[];
};

export class ActivityPrecheckClient {
  constructor(
    private readonly baseUrl?: string,
    private readonly token?: string
  ) {}

  get enabled(): boolean {
    return Boolean(this.baseUrl);
  }

  async precheck(input: {
    seasonId: string;
    activityDate: string;
    threshold: number;
    basePoints: number;
    topicDefinition: string;
    reviewCriteria: string[];
    disqualifiers: string[];
    positiveExamples: string[];
    negativeExamples: string[];
    messages: ActivityMessageInput[];
  }): Promise<ActivityPrecheckResponse> {
    if (!this.baseUrl) {
      throw new AppError(
        "Precheck service not configured",
        "PRECHECK_SERVICE_NOT_CONFIGURED",
        "Set PRECHECK_SERVICE_URL before running the activity precheck."
      );
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/activity/precheck`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      throw new AppError(
        "Precheck service unavailable",
        "PRECHECK_SERVICE_UNAVAILABLE",
        `The activity precheck service could not be reached: ${String(error)}`
      );
    }
    if (!response.ok) {
      throw new AppError(
        "Precheck service failed",
        "PRECHECK_SERVICE_FAILED",
        `The activity precheck service returned HTTP ${response.status}.`
      );
    }
    return (await response.json()) as ActivityPrecheckResponse;
  }
}
