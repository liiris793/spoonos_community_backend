import { beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../src/db/database.js";
import { TaskRepository } from "../src/db/task-repository.js";
import { PluginRegistry } from "../src/plugins/registry.js";
import { RuleBasedPrecheckPlugin } from "../src/plugins/rule-based-precheck.js";
import { SubmissionService } from "../src/services/submission-service.js";
import { PointsRepository } from "../src/db/points-repository.js";
import type {
  PluginContext,
  PrecheckPlugin,
  PrecheckResult,
  TaskConfig
} from "../src/core/types.js";
import { BatchReviewService } from "../src/services/batch-review-service.js";
import * as XLSX from "xlsx";

const sampleTask = (id = "TEST-1"): TaskConfig => ({
  id,
  seasonId: "test-season",
  title: "产品体验报告",
  type: "Contribute",
  difficulty: "Advanced",
  description: "提交真实产品体验。",
  basePoints: 100,
  minPoints: 80,
  maxPoints: 150,
  status: "Published",
  reviewMode: "ai_then_human",
  claimRequired: false,
  revisionAllowed: true,
  limits: { perSeason: 2 },
  requirements: ["提供截图或Demo", "包含实际操作过程"],
  submissionFields: ["summary", "proof_url"],
  pluginIds: ["rule_based_precheck"]
});

class FakeAiPrecheckPlugin implements PrecheckPlugin {
  id = "ai_webhook_precheck";
  calls = 0;

  supports(): boolean {
    return true;
  }

  async run(_context: PluginContext): Promise<PrecheckResult> {
    this.calls += 1;
    return {
      pluginId: this.id,
      score: 88,
      recommendation: "pass",
      flags: [],
      missingItems: [],
      reviewQuestions: [],
      raw: {
        aiResult: {
          reason: "The evidence is specific and reproducible.",
          _provider: { model: "fake-model" }
        }
      }
    };
  }
}

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
  db.prepare(
    "INSERT INTO seasons (id, name, status) VALUES (?, ?, 'Active')"
  ).run("test-season", "Test Season");
});

describe("task versioning", () => {
  it("creates a new version when points change", () => {
    const repository = new TaskRepository();
    repository.create(sampleTask(), "admin");
    const updated = repository.update(
      "TEST-1",
      "test-season",
      { basePoints: 120 },
      "admin"
    );
    expect(updated.currentVersion).toBe(2);
    expect(updated.config.basePoints).toBe(120);
    const versions = db
      .prepare(
        "SELECT version FROM task_versions WHERE task_id = ? ORDER BY version"
      )
      .all("TEST-1") as { version: number }[];
    expect(versions.map((item) => item.version)).toEqual([1, 2]);
  });
});

describe("submission and points", () => {
  it("prechecks, approves and creates an auditable ledger entry", async () => {
    const repository = new TaskRepository();
    repository.create(sampleTask(), "admin");
    const registry = new PluginRegistry();
    registry.register(new RuleBasedPrecheckPlugin());
    const service = new SubmissionService(registry);
    const submission = await service.submit(
      {
        taskId: "TEST-1",
        userId: "user-1",
        summary:
          "我在真实环境中完成了产品测试，记录了完整操作过程、遇到的问题、结果和改进建议。为了便于其他成员复现，我整理了环境信息、具体步骤以及测试结论，并提供了对应证明链接。",
        proofUrl: "https://example.com/evidence"
      },
      "test-season"
    );
    expect(submission.status).toBe("Prechecked");

    const approved = service.review({
      submissionId: submission.id,
      reviewerId: "reviewer-1",
      decision: "approve",
      qualityCoefficient: 1.25,
      note: "证据完整"
    });
    expect(approved.finalPoints).toBe(125);
    expect(new PointsRepository().total("test-season", "user-1")).toBe(125);
    expect(() =>
      service.review({
        submissionId: submission.id,
        reviewerId: "reviewer-1",
        decision: "approve",
        note: "重复审核"
      })
    ).toThrow();
  });

  it("does not compare a submission with itself but flags a later exact duplicate", async () => {
    const repository = new TaskRepository();
    repository.create(sampleTask(), "admin");
    const registry = new PluginRegistry();
    registry.register(new RuleBasedPrecheckPlugin());
    const service = new SubmissionService(registry);
    const summary =
      "I tested the product in a real environment, recorded the complete process, attached evidence, documented the observed result, and included reproducible steps for other community members.";

    const first = await service.submit(
      {
        taskId: "TEST-1",
        userId: "user-1",
        summary,
        proofUrl: "https://example.com/first"
      },
      "test-season"
    );
    expect(first.aiPrecheck?.flags).not.toContain("possible_duplicate");

    const duplicate = await service.submit(
      {
        taskId: "TEST-1",
        userId: "user-2",
        summary,
        proofUrl: "https://example.com/duplicate"
      },
      "test-season"
    );
    expect(duplicate.aiPrecheck?.flags).toContain("possible_duplicate");
  });

  it("uses the task version captured when the submission was created", async () => {
    const repository = new TaskRepository();
    repository.create(sampleTask(), "admin");
    const registry = new PluginRegistry();
    registry.register(new RuleBasedPrecheckPlugin());
    const service = new SubmissionService(registry);
    const submission = await service.submit(
      {
        taskId: "TEST-1",
        userId: "user-1",
        summary:
          "I completed a real product test and documented the environment, steps, observed result, evidence, and a reproducible conclusion for the community.",
        proofUrl: "https://example.com/evidence"
      },
      "test-season"
    );
    repository.update("TEST-1", "test-season", { basePoints: 500 }, "admin");

    const approved = service.review({
      submissionId: submission.id,
      reviewerId: "reviewer-1",
      decision: "approve",
      note: "Evidence verified"
    });

    expect(approved.finalPoints).toBe(100);
  });
});

describe("batch review", () => {
  it("exports completed UTC days and imports decisions idempotently", async () => {
    const repository = new TaskRepository();
    repository.create(sampleTask(), "admin");
    const registry = new PluginRegistry();
    registry.register(new RuleBasedPrecheckPlugin());
    const submissions = new SubmissionService(registry);
    const review = new BatchReviewService(submissions);

    const yesterday = await submissions.submit(
      {
        taskId: "TEST-1",
        userId: "user-yesterday",
        summary:
          "I tested the product in a real environment, recorded each step and result, attached evidence, and documented enough detail for another member to reproduce it.",
        proofUrl: "https://example.com/yesterday"
      },
      "test-season"
    );
    const today = await submissions.submit(
      {
        taskId: "TEST-1",
        userId: "user-today",
        summary:
          "I tested another product workflow in a real environment, recorded each step and result, attached evidence, and documented a reproducible conclusion.",
        proofUrl: "https://example.com/today"
      },
      "test-season"
    );
    db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(
      "2026-07-31 12:00:00",
      yesterday.id
    );
    db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(
      "2026-08-01 01:00:00",
      today.id
    );

    const createdBatch = review.createBatch(
      "test-season",
      "reviewer-1",
      {},
      new Date("2026-08-01T08:00:00.000Z")
    );
    const exported = review.exportBatch(createdBatch.batchId);
    expect(exported.startDate).toBe("2026-07-31");
    expect(exported.endDate).toBe("2026-07-31");
    expect(exported.count).toBe(1);
    expect(exported.csv).toContain(yesterday.id);
    expect(exported.csv).not.toContain(today.id);
    expect(exported.csv).toContain("ai_recommendation");
    expect(exported.csv).toContain("review_decision");

    const workbook = XLSX.read(Buffer.from(exported.csv, "utf8"), {
      type: "buffer"
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: "" }
    );
    rows[0].review_decision = "approve";
    rows[0].final_points = 110;
    rows[0].review_note = "Verified in the batch review";
    const completedWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      completedWorkbook,
      XLSX.utils.json_to_sheet(rows),
      "Review"
    );
    const completed = XLSX.write(completedWorkbook, {
      type: "buffer",
      bookType: "xlsx"
    }) as Buffer;

    const parsed = review.parse(completed, "completed-review.xlsx");
    const result = review.apply(parsed, "reviewer-1");
    expect(result.approved).toBe(1);
    expect(result.awardedPoints).toBe(110);
    expect(new PointsRepository().total("test-season", "user-yesterday")).toBe(
      110
    );

    const repeated = review.apply(parsed, "reviewer-1");
    expect(repeated.approved).toBe(0);
    expect(repeated.skippedFinalized).toBe(1);
    expect(new PointsRepository().total("test-season", "user-yesterday")).toBe(
      110
    );
  });

  it("approves all pending submissions in a batch once", async () => {
    const repository = new TaskRepository();
    repository.create(sampleTask(), "admin");
    const registry = new PluginRegistry();
    registry.register(new RuleBasedPrecheckPlugin());
    const submissions = new SubmissionService(registry);
    const review = new BatchReviewService(submissions);

    for (const userId of ["user-a", "user-b"]) {
      const submission = await submissions.submit(
        {
          taskId: "TEST-1",
          userId,
          summary:
            "I tested the product in a real environment, recorded the complete process and outcome, attached evidence, and documented a reproducible result.",
          proofUrl: `https://example.com/${userId}`
        },
        "test-season"
      );
      db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(
        "2026-07-31 10:00:00",
        submission.id
      );
    }

    const createdBatch = review.createBatch(
      "test-season",
      "reviewer-1",
      {},
      new Date("2026-08-01T08:00:00.000Z")
    );
    const exported = review.exportBatch(createdBatch.batchId);
    const approved = review.approveBatch(exported.batchId, "reviewer-1", {
      qualityCoefficient: 1.25,
      note: "Batch evidence verified"
    });

    expect(approved.approved).toBe(2);
    expect(approved.awardedPoints).toBe(250);

    const repeated = review.approveBatch(exported.batchId, "reviewer-1");
    expect(repeated.approved).toBe(0);
    expect(repeated.skippedFinalized).toBe(2);
    expect(new PointsRepository().total("test-season", "user-a")).toBe(125);
    expect(new PointsRepository().total("test-season", "user-b")).toBe(125);
  });

  it("creates a fixed batch and incrementally AI-previews only unprocessed items", async () => {
    const repository = new TaskRepository();
    repository.create(
      {
        ...sampleTask(),
        pluginIds: ["rule_based_precheck", "ai_webhook_precheck"]
      },
      "admin"
    );
    const registry = new PluginRegistry();
    registry.register(new RuleBasedPrecheckPlugin());
    const ai = new FakeAiPrecheckPlugin();
    registry.register(ai);
    const submissions = new SubmissionService(registry);
    const review = new BatchReviewService(submissions);

    const created = [];
    const summaries: Record<string, string> = {
      "user-a":
        "I reproduced a task-filter reset on desktop Chrome, recorded the navigation path, and proposed persisting filter state in URL parameters. The evidence includes expected behavior, actual behavior, scope, and a measurable impact on task discovery.",
      "user-b":
        "I tested timeout recovery in Arena using an unavailable tool endpoint. The run spinner remained active after the timeout, so I documented the environment, four reproduction steps, console output, expected recovery behavior, and a screen recording.",
      "user-c":
        "I evaluated the first-time contributor documentation with two new testers. Both missed the Discord submission step, so I proposed an evidence checklist and direct submit link, with completion time and valid-submission rate as success metrics."
    };
    for (const userId of ["user-a", "user-b", "user-c"]) {
      const submission = await submissions.submit(
        {
          taskId: "TEST-1",
          userId,
          summary: summaries[userId],
          proofUrl: `https://example.com/${userId}`
        },
        "test-season"
      );
      created.push(submission);
      db.prepare("UPDATE submissions SET created_at = ? WHERE id = ?").run(
        "2026-07-31 10:00:00",
        submission.id
      );
    }

    expect(ai.calls).toBe(0);
    expect(created[0].aiPrecheck?.pluginId).toBe("rule_based_precheck");

    const createdBatch = review.createBatch(
      "test-season",
      "reviewer-1",
      {},
      new Date("2026-08-01T08:00:00.000Z")
    );
    expect(createdBatch.count).toBe(3);
    const firstPreview = await review.previewBatch(createdBatch.batchId, 2);
    expect(firstPreview.processed).toBe(2);
    expect(firstPreview.previewedTotal).toBe(2);
    expect(firstPreview.remaining).toBe(1);
    expect(ai.calls).toBe(2);
    const firstBatch = review.exportBatch(createdBatch.batchId);
    expect(firstBatch.count).toBe(3);
    expect(firstBatch.aiPrechecked).toBe(2);
    expect(firstBatch.aiPending).toBe(1);
    expect(firstBatch.csv).toContain("ai_webhook_precheck");
    const workbook = XLSX.read(Buffer.from(firstBatch.csv, "utf8"), {
      type: "buffer"
    });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: "" }
    );
    expect(rows[0].ai_suggested_decision).toBe("approve");
    expect(rows[0].ai_suggested_coefficient).toBe(1.25);
    expect(rows[0].ai_suggested_points).toBe(125);
    expect(rows[0].ai_reason).toContain("specific and reproducible");
    expect(rows[0].review_decision).toBe("");
    expect(rows[0].final_points).toBe("");

    const secondPreview = await review.previewBatch(createdBatch.batchId, 2);
    expect(secondPreview.processed).toBe(1);
    expect(secondPreview.previewedTotal).toBe(3);
    expect(secondPreview.remaining).toBe(0);
    expect(ai.calls).toBe(3);

    const approved = review.approveBatch(createdBatch.batchId, "reviewer-1", {
      pointMode: "ai_suggested",
      note: "AI suggestions verified by the reviewer"
    });
    expect(approved.approved).toBe(3);
    expect(approved.awardedPoints).toBeGreaterThan(0);
  });
});

describe("rule-based precheck", () => {
  it("flags missing evidence and thin content", async () => {
    const plugin = new RuleBasedPrecheckPlugin();
    const task = {
      id: "TEST-1",
      seasonId: "test-season",
      status: "Published" as const,
      currentVersion: 1,
      config: sampleTask()
    };
    const result = await plugin.run({
      task,
      submission: {
        id: "sub-1",
        seasonId: "test-season",
        taskId: "TEST-1",
        taskVersion: 1,
        userId: "user-1",
        summary: "做完了，挺好的。",
        status: "Submitted",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      recentSubmissionTexts: []
    });
    expect(result.flags).toContain("summary_too_short");
    expect(result.flags).toContain("evidence_missing");
    expect(result.recommendation).toBe("revision");
  });
});
