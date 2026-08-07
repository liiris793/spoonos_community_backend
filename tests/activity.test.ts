import { beforeEach, describe, expect, it } from "vitest";
import type { TaskConfig } from "../src/core/types.js";
import { db, migrate } from "../src/db/database.js";
import { PointsRepository } from "../src/db/points-repository.js";
import { TaskRepository } from "../src/db/task-repository.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { ActivityPrecheckClient } from "../src/services/activity-precheck-client.js";
import { ActivityService } from "../src/services/activity-service.js";
import { TaskService } from "../src/services/task-service.js";

class FakeActivityPrecheck extends ActivityPrecheckClient {
  private validCount: number;
  constructor(validCount = 5) {
    super();
    this.validCount = validCount;
  }
  override async precheck(input: Parameters<ActivityPrecheckClient["precheck"]>[0]) {
    return {
      activityDate: input.activityDate,
      users: [
        {
          userId: "user-1",
          candidateMessages: input.messages.length,
          rulePassedMessages: input.messages.length,
          aiValidMessages: this.validCount,
          suggestedPoints: Math.min(this.validCount, 5) * 4,
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
  limits: { perDay: 1 },
  seasonPointsCap: 800,
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
  it("auto-approves submission and awards points immediately", async () => {
    const activity = new ActivityService(
      new TaskService(),
      new FakeActivityPrecheck(),
      undefined,
      ["channel-1"],
      new PointsRepository()
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
    expect(new PointsRepository().total("test-season", "user-1")).toBe(20);

    const submission = db.prepare(
      "SELECT id, status FROM submissions WHERE task_id = 'T001'"
    ).get() as { id: string; status: string };
    expect(submission.status).toBe("Approved");
  });

  it("skips users who reached the season points cap", async () => {
    const pointsRepo = new PointsRepository();
    const activity = new ActivityService(
      new TaskService(),
      new FakeActivityPrecheck(),
      undefined,
      ["channel-1"],
      pointsRepo
    );
    // Pre-award enough points to be near the cap
    pointsRepo.add({
      seasonId: "test-season",
      userId: "user-1",
      taskId: "T001",
      submissionId: "manual-sub",
      basePoints: 20,
      multiplier: 1,
      points: 790,
      reason: "Pre-existing points",
      operatorId: "test"
    });

    for (let index = 1; index <= 5; index += 1) {
      activity.recordMessage("test-season", {
        messageId: `msg-cap-${index}`,
        userId: "user-1",
        channelId: "channel-1",
        content: `Meaningful message ${index} about SpoonOS.`,
        createdAtUtc: `2026-07-31T10:0${index}:00.000Z`
      });
    }

    const result = await activity.prepareDailyReview("test-season", "2026-07-31");
    expect(result.submissionsCreated).toBe(1);
    // Should only award 10 points (800 - 790 = 10)
    expect(pointsRepo.total("test-season", "user-1")).toBe(800);
  });

  it("awards partial points based on valid message count (3 valid = 12 points)", async () => {
    const activity = new ActivityService(
      new TaskService(),
      new FakeActivityPrecheck(3),
      undefined,
      ["channel-1"],
      new PointsRepository()
    );
    for (let index = 1; index <= 5; index += 1) {
      activity.recordMessage("test-season", {
        messageId: `partial-${index}`,
        userId: "user-1",
        channelId: "channel-1",
        content: `SpoonOS discussion message ${index}.`,
        createdAtUtc: `2026-08-01T10:0${index}:00.000Z`
      });
    }

    const result = await activity.prepareDailyReview("test-season", "2026-08-01");
    expect(result.submissionsCreated).toBe(1);
    expect(result.pointsAwarded).toBe(12);
    expect(new PointsRepository().total("test-season", "user-1")).toBe(12);
  });

  it("awards 0 points when no valid messages", async () => {
    const activity = new ActivityService(
      new TaskService(),
      new FakeActivityPrecheck(0),
      undefined,
      ["channel-1"],
      new PointsRepository()
    );
    for (let index = 1; index <= 5; index += 1) {
      activity.recordMessage("test-season", {
        messageId: `nosh-${index}`,
        userId: "user-1",
        channelId: "channel-1",
        content: `Message ${index}.`,
        createdAtUtc: `2026-08-02T10:0${index}:00.000Z`
      });
    }

    const result = await activity.prepareDailyReview("test-season", "2026-08-02");
    expect(result.submissionsCreated).toBe(0);
    expect(result.pointsAwarded).toBe(0);
  });
});
