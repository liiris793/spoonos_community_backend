import { AppError } from "../core/errors.js";
import * as XLSX from "xlsx";
import type {
  PrecheckResult,
  ReviewDecision,
  SubmissionInput,
  SubmissionRecord,
  TaskRecord,
  TaskStatus
} from "../core/types.js";
import { SubmissionRepository } from "../db/submission-repository.js";
import { PointsRepository } from "../db/points-repository.js";
import { PluginRegistry } from "../plugins/registry.js";
import { TaskService } from "./task-service.js";
import { db } from "../db/database.js";
import type { TaskConfig } from "../core/types.js";

function startOfUtcPeriod(period: "day" | "week" | "month"): string {
  const now = new Date();
  if (period === "week") {
    const day = now.getUTCDay() || 7;
    now.setUTCDate(now.getUTCDate() - day + 1);
  } else if (period === "month") {
    now.setUTCDate(1);
  }
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

const AI_PRECHECK_PLUGIN_ID = "ai_webhook_precheck";

export class SubmissionService {
  constructor(
    private readonly plugins: PluginRegistry,
    private readonly tasks = new TaskService(),
    private readonly submissions = new SubmissionRepository(),
    private readonly points = new PointsRepository()
  ) {}

  async submit(
    input: SubmissionInput,
    seasonId: string
  ): Promise<SubmissionRecord> {
    const task = this.tasks.get(input.taskId, seasonId);
    if (task.status !== "Published") {
      throw new AppError("Task unavailable", "TASK_UNAVAILABLE");
    }
    if (!input.summary.trim()) {
      throw new AppError("Summary required", "SUMMARY_REQUIRED");
    }
    if (task.config.reviewMode === "auto") {
      throw new AppError(
        "Automatic task",
        "AUTOMATIC_TASK",
        "This task is settled automatically from community activity and does not accept manual submissions."
      );
    }
    if (task.config.claimRequired) {
      const claim = db
        .prepare(
          `SELECT id FROM claims
           WHERE season_id = ? AND task_id = ? AND user_id = ? AND status = 'Active'`
        )
        .get(seasonId, input.taskId, input.userId);
      if (!claim) {
        throw new AppError(
          "Claim required",
          "CLAIM_REQUIRED",
          "Claim this task before submitting evidence."
        );
      }
    }

    const limits = task.config.limits;
    if (limits.perDay) {
      const used = this.submissions.countCounted(
        seasonId,
        input.taskId,
        input.userId,
        startOfUtcPeriod("day")
      );
      if (used >= limits.perDay) {
        throw new AppError("Daily limit reached", "DAILY_LIMIT");
      }
    }
    if (limits.perWeek) {
      const used = this.submissions.countCounted(
        seasonId,
        input.taskId,
        input.userId,
        startOfUtcPeriod("week")
      );
      if (used >= limits.perWeek) {
        throw new AppError(
          "Weekly limit reached",
          "WEEKLY_LIMIT",
          "You have reached this task's weekly submission limit."
        );
      }
    }
    if (limits.perMonth) {
      const used = this.submissions.countCounted(
        seasonId,
        input.taskId,
        input.userId,
        startOfUtcPeriod("month")
      );
      if (used >= limits.perMonth) {
        throw new AppError(
          "Monthly limit reached",
          "MONTHLY_LIMIT",
          "You have reached this task's monthly submission limit."
        );
      }
    }
    if (limits.perSeason) {
      const used = this.submissions.countCounted(
        seasonId,
        input.taskId,
        input.userId
      );
      if (used >= limits.perSeason) {
        throw new AppError(
          "Season limit reached",
          "SEASON_LIMIT",
          "You have reached this task's season submission limit."
        );
      }
    }

    let submission = this.submissions.create(
      input,
      seasonId,
      task.currentVersion
    );

    // Keep user submissions fast and deterministic. AI is deliberately deferred
    // until an operator requests it while creating a review export.
    const results = await this.plugins.run(
      task.config.pluginIds.filter((id) => id !== AI_PRECHECK_PLUGIN_ID),
      {
        task,
        submission,
        recentSubmissionTexts: this.submissions.listRecentTexts(
          seasonId,
          input.taskId,
          100,
          submission.id
        )
      }
    );
    const combined = this.combinePrechecks(results);
    if (combined) {
      submission = this.submissions.updateStatus(submission.id, "Prechecked", {
        aiPrecheck: combined
      });
    }
    return submission;
  }

  /** Run rule + AI prechecks on demand for an existing review batch. */
  async precheckWithAi(submissionId: string): Promise<SubmissionRecord> {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new AppError(
        "Submission not found",
        "SUBMISSION_NOT_FOUND",
        "The submission could not be found."
      );
    }
    if (
      !["Submitted", "Prechecked", "UnderReview"].includes(submission.status)
    ) {
      throw new AppError(
        "Submission is already finalized",
        "SUBMISSION_FINALIZED",
        `Submission ${submission.id} can no longer be AI prechecked.`
      );
    }

    const aiPlugin = this.plugins.get(AI_PRECHECK_PLUGIN_ID);
    if (!aiPlugin) {
      throw new AppError(
        "AI precheck service is not configured",
        "AI_PRECHECK_NOT_CONFIGURED",
        "Set PRECHECK_SERVICE_URL, start the review service, and restart the Bot before requesting an AI review export."
      );
    }

    const versionRow = db
      .prepare(
        `SELECT t.status, v.config_json
         FROM tasks t
         JOIN task_versions v
           ON v.task_id = t.id
          AND v.season_id = t.season_id
          AND v.version = ?
         WHERE t.id = ? AND t.season_id = ?`
      )
      .get(
        submission.taskVersion,
        submission.taskId,
        submission.seasonId
      ) as { status: TaskStatus; config_json: string } | undefined;
    if (!versionRow) {
      throw new AppError(
        "Task version not found",
        "TASK_VERSION_NOT_FOUND",
        `The task version used by submission ${submission.id} could not be found.`
      );
    }

    const task: TaskRecord = {
      id: submission.taskId,
      seasonId: submission.seasonId,
      status: versionRow.status,
      currentVersion: submission.taskVersion,
      config: JSON.parse(versionRow.config_json) as TaskConfig
    };
    // Automatic activity submissions already contain their dedicated
    // per-message AI assessment. Do not replace it with the generic webhook
    // pipeline when preparing the settlement sheet.
    if (
      task.config.reviewMode === "auto" &&
      submission.aiPrecheck?.pluginId.includes("daily_activity_v1")
    ) {
      return submission;
    }
    const context = {
      task,
      submission,
      recentSubmissionTexts: this.submissions.listRecentTexts(
        submission.seasonId,
        submission.taskId,
        100,
        submission.id
      )
    };

    const results: PrecheckResult[] = [];
    const rulePlugin = this.plugins.get("rule_based_precheck");
    if (rulePlugin) results.push(await rulePlugin.run(context));
    results.push(await aiPlugin.run(context));

    const combined = this.combinePrechecks(results);
    if (!combined) return submission;
    return this.submissions.updatePrecheck(submission.id, combined);
  }

  review(decision: ReviewDecision): SubmissionRecord {
    const submission = this.submissions.get(decision.submissionId);
    if (!submission) {
      throw new AppError(
        "Submission not found",
        "SUBMISSION_NOT_FOUND",
        "The submission could not be found."
      );
    }
    if (submission.status === "Approved") {
      throw new AppError(
        "Already approved",
        "ALREADY_APPROVED",
        "This submission has already been approved."
      );
    }

    if (decision.decision === "revision") {
      return this.submissions.updateStatus(
        submission.id,
        "RevisionRequired",
        {
          reviewerId: decision.reviewerId,
          reviewNote: decision.note
        }
      );
    }
    if (decision.decision === "reject") {
      return this.submissions.updateStatus(submission.id, "Rejected", {
        reviewerId: decision.reviewerId,
        reviewNote: decision.note
      });
    }

    const versionRow = db
      .prepare(
        `SELECT config_json FROM task_versions
         WHERE task_id = ? AND season_id = ? AND version = ?`
      )
      .get(
        submission.taskId,
        submission.seasonId,
        submission.taskVersion
      ) as { config_json: string } | undefined;
    if (!versionRow) {
      throw new AppError(
        "Task version not found",
        "TASK_VERSION_NOT_FOUND",
        "The task version used by this submission could not be found."
      );
    }
    const taskConfig = JSON.parse(versionRow.config_json) as TaskConfig;
    if (
      submission.taskId === "T001" &&
      submission.structuredData?.source === "daily_activity_precheck" &&
      taskConfig.limits.perWeek
    ) {
      const activityDate = String(
        submission.structuredData.activityDate ?? submission.createdAt.slice(0, 10)
      );
      const weekStartDate = new Date(`${activityDate}T00:00:00.000Z`);
      const weekday = weekStartDate.getUTCDay() || 7;
      weekStartDate.setUTCDate(weekStartDate.getUTCDate() - weekday + 1);
      const weekStart = weekStartDate.toISOString().slice(0, 10);
      weekStartDate.setUTCDate(weekStartDate.getUTCDate() + 7);
      const weekEnd = weekStartDate.toISOString().slice(0, 10);
      const approved = db.prepare(
        `SELECT COUNT(*) AS count FROM submissions
         WHERE season_id = ? AND user_id = ? AND task_id = 'T001'
           AND status = 'Approved'
           AND created_at >= ? AND created_at < ?`
      ).get(
        submission.seasonId,
        submission.userId,
        `${weekStart} 00:00:00`,
        `${weekEnd} 00:00:00`
      ) as { count: number };
      if (approved.count >= taskConfig.limits.perWeek) {
        throw new AppError(
          "Weekly limit reached",
          "WEEKLY_LIMIT",
          "This member has already reached the weekly T001 reward limit."
        );
      }
    }
    if (
      decision.finalPoints != null &&
      decision.qualityCoefficient != null
    ) {
      throw new AppError(
        "Choose points or coefficient",
        "POINTS_AND_COEFFICIENT_CONFLICT",
        "Provide either final_points or quality_coefficient, not both."
      );
    }
    if (
      decision.finalPoints != null &&
      (!Number.isInteger(decision.finalPoints) || decision.finalPoints <= 0)
    ) {
      throw new AppError(
        "Invalid final points",
        "INVALID_FINAL_POINTS",
        "final_points must be a positive whole number for approved submissions."
      );
    }
    const maximumPoints =
      taskConfig.maxPoints ?? Math.round(taskConfig.basePoints * 1.5);
    if (
      decision.finalPoints != null &&
      decision.finalPoints > maximumPoints
    ) {
      throw new AppError(
        "Final points exceed task maximum",
        "FINAL_POINTS_EXCEED_MAXIMUM",
        `final_points may not exceed ${maximumPoints} for this task.`
      );
    }

    const coefficient =
      decision.finalPoints != null
        ? decision.finalPoints / taskConfig.basePoints
        : decision.qualityCoefficient ?? 1;
    if (
      decision.finalPoints == null &&
      ![0.5, 1, 1.25, 1.5].includes(coefficient)
    ) {
      throw new AppError(
        "Invalid coefficient",
        "INVALID_COEFFICIENT",
        "The quality coefficient must be 0.5, 1, 1.25, or 1.5."
      );
    }
    const rawPoints = Math.round(taskConfig.basePoints * coefficient);
    const points = decision.finalPoints ?? Math.min(maximumPoints, rawPoints);

    this.points.add({
      seasonId: submission.seasonId,
      userId: submission.userId,
      taskId: submission.taskId,
      submissionId: submission.id,
      basePoints: taskConfig.basePoints,
      multiplier: coefficient,
      points,
      reason: "Task submission approved",
      operatorId: decision.reviewerId
    });
    return this.submissions.updateStatus(submission.id, "Approved", {
      reviewerId: decision.reviewerId,
      reviewNote: decision.note,
      qualityCoefficient: coefficient,
      finalPoints: points
    });
  }

  /** Build an xlsx workbook (as a Buffer) containing every submission by a user. */
  exportUserSubmissions(seasonId: string, userId: string): Buffer {
    const rows = this.submissions.listByUser(seasonId, userId);
    const headers = [
      "Submission ID",
      "Task ID",
      "Status",
      "Points",
      "Review Note",
      "Submitted At",
      "Summary"
    ];
    const data = rows.map((s) => [
      s.id,
      s.taskId,
      s.status,
      s.finalPoints != null ? s.finalPoints : "",
      s.reviewNote ?? "",
      s.createdAt,
      s.summary
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    sheet["!cols"] = headers.map((h, i) => ({
      wch: i === headers.length - 1 ? 60 : Math.max(12, h.length + 2)
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "My Submissions");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  private combinePrechecks(
    results: PrecheckResult[]
  ): PrecheckResult | undefined {
    if (!results.length) return undefined;
    const score = Math.round(
      results.reduce((sum, item) => sum + item.score, 0) / results.length
    );
    const hasRevision = results.some(
      (item) => item.recommendation === "revision"
    );
    const hasReview = results.some((item) => item.recommendation === "review");
    return {
      pluginId: results.map((item) => item.pluginId).join(","),
      score,
      recommendation: hasRevision ? "revision" : hasReview ? "review" : "pass",
      flags: [...new Set(results.flatMap((item) => item.flags))],
      missingItems: [...new Set(results.flatMap((item) => item.missingItems))],
      reviewQuestions: [
        ...new Set(results.flatMap((item) => item.reviewQuestions))
      ],
      raw: results
    };
  }
}
