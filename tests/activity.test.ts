import { beforeEach, describe, expect, it } from "vitest";
import type { TaskConfig } from "../src/core/types.js";
import { db, migrate } from "../src/db/database.js";
import { PointsRepository } from "../src/db/points-repository.js";
import { TaskRepository } from "../src/db/task-repository.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { ActivityPrecheckClient } from "../src/services/activity-precheck-client.js";
import { ActivityService } from "../src/services/activity-service.js";
import { SubmissionService } from "../src/services/submission-service.js";
import { TaskService } from "../src/services/task-service.js";

class FakeActivityPrecheck extends ActivityPrecheckClient {
  override async precheck(input: Parameters<ActivityPrecheckClient["precheck"]>[0]) {
    return {
      activityDate: input.activityDate,
      users: [
        {
          userId: "user-1",
          candidateMessages: 5,
          rulePassedMessages: 5,
          aiValidMessages: 5,
          suggestedPoints: 20,
          recommendation: "pass" as const,
          flags: [],
          reviewQuestions: ["Verify the topic relevance."],
          messages: input.messages.map((message) => ({
            messageId: message.messageId,
            ruleStatus: "pass" as const,
            ruleFlags: [],
            aiStatus: "valid" as const,
            relevanceScore: 90,
            qualityScore: 80,
            reason: "Relevant and substantive"
          }))
        }
      ]
    };
  }
}

const activityTask: TaskConfig = {
  id: "T001",
  seasonId: "test-season",
  title: "Daily Community Activity",
  type: "Daily",
  difficulty: "Quick",
  description: "Post five meaningful topic-related messages.",
  basePoints: 20,
  status: "Published",
  reviewMode: "auto",
  claimRequired: false,
  revisionAllowed: false,
  limits: { perDay: 1, perWeek: 5 },
  requirements: [],
  submissionFields: [],
  pluginIds: [],
  allowedChannelIds: ["channel-1"],
  topicDefinition: "SpoonOS and AI agents"
};

beforeEach(() => {
  migrate();
  db.exec(`
    DELETE FROM point_ledger;
    DELETE FROM review_batch_items;
    DELETE FROM review_batches;
    DELETE FROM activity_daily_reviews;
    DELETE FROM activity_messages;
    DELETE FROM submissions;
    DELETE FROM claims;
    DELETE FROM task_versions;
    DELETE FROM tasks;
    DELETE FROM seasons;
  `);
  db.prepare("INSERT INTO seasons (id, name, status) VALUES (?, ?, 'Active')")
    .run("test-season", "Test Season");
  new TaskRepository().create(activityTask, "test");
});

describe("daily activity pre-review", () => {
  it("creates a prechecked submission but awards no points until human approval", async () => {
    const activity = new ActivityService(
      new TaskService(),
      new FakeActivityPrecheck(),
      undefined,
      ["channel-1"]
    );
    for (let index = 1; index <= 5; index += 1) {
      expect(activity.recordMessage("test-season", {
        messageId: `message-${index}`,
        userId: "user-1",
        channelId: "channel-1",
        content: `This is meaningful SpoonOS discussion message number ${index}.`,
        createdAtUtc: `2026-07-30T10:0${index}:00.000Z`
      })).toBe(true);
    }
    expect(activity.recordMessage("test-season", {
      messageId: "outside-channel",
      userId: "user-1",
      channelId: "other-channel",
      content: "This message must not be collected.",
      createdAtUtc: "2026-07-30T10:30:00.000Z"
    })).toBe(false);

    const result = await activity.prepareDailyReview("test-season", "2026-07-30");
    expect(result.submissionsCreated).toBe(1);
    expect(new PointsRepository().total("test-season", "user-1")).toBe(0);

    const submission = db.prepare(
      "SELECT id, status FROM submissions WHERE task_id = 'T001'"
    ).get() as { id: string; status: string };
    expect(submission.status).toBe("Prechecked");

    new SubmissionService(new PluginRegistry()).review({
      submissionId: submission.id,
      reviewerId: "reviewer-1",
      decision: "approve",
      note: "Messages verified"
    });
    expect(new PointsRepository().total("test-season", "user-1")).toBe(20);
  });
});
