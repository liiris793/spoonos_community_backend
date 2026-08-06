import { db, migrate } from "../db/database.js";
import type { PrecheckResult } from "../core/types.js";
import { SubmissionRepository } from "../db/submission-repository.js";
import { seed } from "./seed.js";
import { TaskService } from "../services/task-service.js";

type MockCase = {
  id: string;
  taskId: string;
  userId: string;
  summary: string;
  proofUrl?: string;
  attachmentUrl?: string;
  precheck: PrecheckResult;
  structuredData?: Record<string, unknown>;
};

const requestedDate = process.argv[2];
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const activityDate = requestedDate ?? yesterday;

if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
  throw new Error("Optional date must use YYYY-MM-DD UTC format.");
}

const dailyEvidence = (
  userId: string,
  quality: "good" | "mixed" | "poor"
): Record<string, unknown>[] => {
  const examples = {
    good: [
      "I tested the Arena retry flow today. Keeping the previous prompt after an error would save time.",
      "The agent result was useful, but the loading state did not explain whether tools were still running.",
      "For the FAQ, we should add one example showing how a beginner creates their first workflow.",
      "Does the current Skill Marketplace ranking consider recent usage or only total installs?",
      "I reproduced the issue on Chrome 127 and recorded the exact steps for the product channel."
    ],
    mixed: [
      "The Arena result page is clearer than before, especially the separated tool output.",
      "I think the onboarding guide needs one screenshot for the role selection step.",
      "This AI agent article relates to our discussion because it compares planning and execution loops.",
      "nice update",
      "gm everyone"
    ],
    poor: ["gm", "nice", "thanks", "🔥🔥🔥", "https://example.com"]
  }[quality];
  return examples.map((content, index) => {
    const valid = quality === "good" || (quality === "mixed" && index < 3);
    return {
      messageId: `mock_${userId}_${index + 1}`,
      channelId: "123456789012345678",
      content,
      createdAtUtc: `${activityDate}T${String(9 + index).padStart(2, "0")}:15:00.000Z`,
      ruleStatus: valid ? "pass" : "fail",
      ruleFlags: valid ? [] : [index === 4 ? "greeting_or_low_value" : "too_short"],
      aiStatus: valid ? "valid" : "invalid",
      relevanceScore: valid ? 88 - index * 3 : 10,
      qualityScore: valid ? 82 - index * 2 : 8,
      reason: valid
        ? "Relevant to SpoonOS and includes a concrete observation."
        : "Low-substance message that does not demonstrate meaningful participation."
    };
  });
};

const precheck = (
  score: number,
  recommendation: PrecheckResult["recommendation"],
  flags: string[],
  missingItems: string[],
  reason: string,
  questions: string[] = []
): PrecheckResult => ({
  pluginId: "rule_based_precheck,ai_webhook_precheck",
  score,
  recommendation,
  flags,
  missingItems,
  reviewQuestions: questions,
  raw: {
    simulated: true,
    reason,
    rubric: {
      relevance: Math.max(0, score - 3),
      specificity: score,
      evidence: Math.max(0, score - 8),
      originality: Math.max(0, score - 5)
    }
  }
});

const goodDaily = dailyEvidence("100000000000000001", "good");
const mixedDaily = dailyEvidence("100000000000000002", "mixed");
const poorDaily = dailyEvidence("100000000000000003", "poor");

const cases: MockCase[] = [
  {
    id: "daily-pass",
    taskId: "T001",
    userId: "100000000000000001",
    summary: "Daily activity precheck: 5 candidates, 5 rule-passed, 5 AI-valid, suggested 20 points.",
    precheck: {
      ...precheck(92, "pass", [], [], "All five messages are relevant, specific, and substantive."),
      pluginId: "daily_activity_v1"
    },
    structuredData: {
      source: "daily_activity_precheck",
      activityDate,
      candidateMessages: 5,
      rulePassedMessages: 5,
      aiValidMessages: 5,
      suggestedPoints: 20,
      messageEvidence: goodDaily
    }
  },
  {
    id: "daily-review",
    taskId: "T001",
    userId: "100000000000000002",
    summary: "Daily activity precheck: 5 candidates, 3 rule-passed, 3 AI-valid, suggested 0 points.",
    precheck: {
      ...precheck(
        58,
        "review",
        ["daily_threshold_not_met", "mixed_message_quality"],
        ["Two more meaningful topic-related messages"],
        "Three messages are useful; two are greetings or generic reactions.",
        ["Confirm whether any excluded messages contain context not visible in the export."]
      ),
      pluginId: "daily_activity_v1"
    },
    structuredData: {
      source: "daily_activity_precheck",
      activityDate,
      candidateMessages: 5,
      rulePassedMessages: 3,
      aiValidMessages: 3,
      suggestedPoints: 0,
      messageEvidence: mixedDaily
    }
  },
  {
    id: "daily-revision",
    taskId: "T001",
    userId: "100000000000000003",
    summary: "Daily activity precheck: 5 candidates, 0 rule-passed, 0 AI-valid, suggested 0 points.",
    precheck: {
      ...precheck(
        12,
        "revision",
        ["daily_threshold_not_met", "greeting_or_low_value", "link_or_emoji_only"],
        ["Five meaningful topic-related messages"],
        "Every candidate was a greeting, reaction, emoji, or link-only message."
      ),
      pluginId: "daily_activity_v1"
    },
    structuredData: {
      source: "daily_activity_precheck",
      activityDate,
      candidateMessages: 5,
      rulePassedMessages: 0,
      aiValidMessages: 0,
      suggestedPoints: 0,
      messageEvidence: poorDaily
    }
  },
  {
    id: "proposal-pass",
    taskId: "T005",
    userId: "100000000000000004",
    summary: "Problem: users lose their task filters after opening a task and returning to the list. Solution: persist type and difficulty filters in the URL and browser session. Impact: contributors can compare several tasks without repeating navigation. Scope: task portal filter state only. I reproduced this on desktop Chrome and attached a short recording.",
    proofUrl: "https://example.com/mock/filter-state-recording",
    precheck: precheck(91, "pass", [], [], "The proposal describes a reproducible problem, bounded solution, impact, and scope."),
    structuredData: { source: "mock_submission", proposalSections: ["problem", "solution", "impact", "scope"] }
  },
  {
    id: "proposal-review",
    taskId: "T005",
    userId: "100000000000000005",
    summary: "The leaderboard should show recent contribution momentum. Add an optional seven-day points indicator so members understand who is currently active. This may improve motivation, but I have not validated whether it changes participation.",
    precheck: precheck(
      67,
      "review",
      ["impact_not_validated"],
      [],
      "The idea is specific, but evidence and expected success criteria are limited.",
      ["Ask the contributor which metric should define seven-day momentum."]
    ),
    structuredData: { source: "mock_submission" }
  },
  {
    id: "proposal-revision",
    taskId: "T005",
    userId: "100000000000000006",
    summary: "Make the product better and add more AI features because users will like it.",
    precheck: precheck(
      24,
      "revision",
      ["proposal_too_short", "generic_claim", "missing_scope"],
      ["Specific problem", "Actionable solution", "Expected impact", "Scope or evidence"],
      "The submission is generic and cannot be reproduced or evaluated."
    ),
    structuredData: { source: "mock_submission" }
  },
  {
    id: "share-pass",
    taskId: "T006",
    userId: "100000000000000007",
    summary: "Source: https://example.com/research/agent-evaluation. The useful point is that agent benchmarks should separate planning failures from tool-execution failures. For SpoonOS discussions, this gives us a better way to write bug reports: state whether the plan was wrong or the tool result was mishandled, then attach the relevant trace.",
    proofUrl: "https://example.com/research/agent-evaluation",
    precheck: precheck(89, "pass", [], [], "The source is present and the contributor adds a concrete SpoonOS-oriented interpretation."),
    structuredData: { source: "mock_submission", sourceUrl: "https://example.com/research/agent-evaluation" }
  },
  {
    id: "share-review",
    taskId: "T006",
    userId: "100000000000000008",
    summary: "Source: https://example.com/ai-news. This article discusses a new reasoning model. It may be useful for agent workflows, although the post does not include evaluation details and I have not tested its claims.",
    proofUrl: "https://example.com/ai-news",
    precheck: precheck(
      61,
      "review",
      ["source_claims_not_verified", "limited_personal_analysis"],
      [],
      "The format is complete but community value and factual support need a manual check.",
      ["Open the source and verify whether it contains the claimed evaluation information."]
    ),
    structuredData: { source: "mock_submission", sourceUrl: "https://example.com/ai-news" }
  },
  {
    id: "share-revision",
    taskId: "T006",
    userId: "100000000000000009",
    summary: "Big AI news today! Very important and everyone should read it.",
    precheck: precheck(
      18,
      "revision",
      ["missing_source_url", "insufficient_personal_analysis"],
      ["Original source URL", "Personal analysis tied to the community"],
      "No source or substantive personal perspective was provided."
    ),
    structuredData: { source: "mock_submission" }
  },
  {
    id: "social-review",
    taskId: "T012",
    userId: "100000000000000010",
    summary: "I reposted the designated update and added that persistent task filters would make the contribution portal easier to explore.",
    proofUrl: "https://x.com/mock_contributor/status/1900000000000000000",
    precheck: precheck(
      72,
      "review",
      ["x_identity_and_action_require_manual_or_api_verification"],
      [],
      "The interaction text is relevant, but ownership and repost status require an X API or manual check.",
      ["Verify that the X account belongs to this Discord member and the repost is still public."]
    ),
    structuredData: { source: "mock_submission", targetPostId: "1899999999999999999" }
  }
];

migrate();
seed();

const tasks = new TaskService();
const submissions = new SubmissionRepository();
let created = 0;
let skipped = 0;

for (const [index, item] of cases.entries()) {
  const existing = db.prepare(
    `SELECT id FROM submissions
     WHERE json_extract(structured_data_json, '$.mockCaseId') = ?`
  ).get(item.id);
  if (existing) {
    skipped += 1;
    continue;
  }
  const task = tasks.get(item.taskId, "season-2");
  const submission = submissions.create(
    {
      taskId: item.taskId,
      userId: item.userId,
      summary: item.summary,
      proofUrl: item.proofUrl,
      attachmentUrl: item.attachmentUrl,
      structuredData: {
        ...(item.structuredData ?? {}),
        mockCaseId: item.id,
        simulated: true
      }
    },
    "season-2",
    task.currentVersion
  );
  submissions.updateStatus(submission.id, "Prechecked", {
    aiPrecheck: item.precheck
  });
  const hour = String(8 + index).padStart(2, "0");
  db.prepare(
    "UPDATE submissions SET created_at = ?, updated_at = ? WHERE id = ?"
  ).run(
    `${activityDate} ${hour}:30:00`,
    `${activityDate} ${hour}:30:00`,
    submission.id
  );
  created += 1;
}

console.log(
  `Mock submissions ready for ${activityDate} UTC. Created ${created}; skipped existing ${skipped}.`
);
