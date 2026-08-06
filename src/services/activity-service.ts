import { AppError } from "../core/errors.js";
import type { PrecheckResult } from "../core/types.js";
import { db } from "../db/database.js";
import { SubmissionRepository } from "../db/submission-repository.js";
import { ActivityPrecheckClient, type ActivityMessageInput } from "./activity-precheck-client.js";
import { TaskService } from "./task-service.js";

const utcDate = (date = new Date()): string => date.toISOString().slice(0, 10);

function parseUtcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError("Invalid date", "INVALID_UTC_DATE", "Use UTC date format YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || utcDate(parsed) !== value) {
    throw new AppError("Invalid date", "INVALID_UTC_DATE", "Use a valid UTC calendar date.");
  }
  return parsed;
}

function nextUtcDate(value: string): string {
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return utcDate(date);
}

type ActivityRow = {
  message_id: string;
  user_id: string;
  channel_id: string;
  content: string;
  created_at_utc: string;
  reply_to_message_id: string | null;
};

export type DailyPrecheckSummary = {
  activityDate: string;
  messages: number;
  users: number;
  submissionsCreated: number;
  skippedWeeklyLimit: number;
};

export class ActivityService {
  constructor(
    private readonly tasks = new TaskService(),
    private readonly precheck = new ActivityPrecheckClient(),
    private readonly submissions = new SubmissionRepository(),
    private readonly configuredChannelIds: string[] = []
  ) {}

  allowedChannelIds(seasonId: string): string[] {
    const taskChannels = this.tasks.get("T001", seasonId).config.allowedChannelIds ?? [];
    return taskChannels.length ? taskChannels : this.configuredChannelIds;
  }

  isAllowedChannel(seasonId: string, channelId: string): boolean {
    const allowed = this.allowedChannelIds(seasonId);
    return allowed.length > 0 && allowed.includes(channelId);
  }

  recordMessage(seasonId: string, message: ActivityMessageInput): boolean {
    if (!this.isAllowedChannel(seasonId, message.channelId)) return false;
    const result = db.prepare(
      `INSERT OR IGNORE INTO activity_messages
        (message_id, season_id, user_id, channel_id, content,
         reply_to_message_id, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      message.messageId,
      seasonId,
      message.userId,
      message.channelId,
      message.content,
      message.replyToMessageId ?? null,
      message.createdAtUtc
    );
    return result.changes > 0;
  }

  markDeleted(messageId: string): void {
    db.prepare("UPDATE activity_messages SET deleted = 1 WHERE message_id = ?").run(messageId);
  }

  status(seasonId: string, activityDate: string): {
    messages: number;
    users: number;
    reviews: number;
  } {
    parseUtcDate(activityDate);
    const end = nextUtcDate(activityDate);
    const messages = db.prepare(
      `SELECT COUNT(*) AS messages, COUNT(DISTINCT user_id) AS users
       FROM activity_messages
       WHERE season_id = ? AND deleted = 0
         AND created_at_utc >= ? AND created_at_utc < ?`
    ).get(seasonId, `${activityDate}T00:00:00.000Z`, `${end}T00:00:00.000Z`) as {
      messages: number;
      users: number;
    };
    const reviews = db.prepare(
      `SELECT COUNT(*) AS count FROM activity_daily_reviews
       WHERE season_id = ? AND activity_date = ?`
    ).get(seasonId, activityDate) as { count: number };
    return { ...messages, reviews: reviews.count };
  }

  async prepareDailyReview(
    seasonId: string,
    activityDate: string
  ): Promise<DailyPrecheckSummary> {
    parseUtcDate(activityDate);
    if (activityDate >= utcDate()) {
      throw new AppError(
        "UTC day not complete",
        "UTC_DAY_NOT_COMPLETE",
        "Activity prechecks can only run for a completed UTC day."
      );
    }
    const task = this.tasks.get("T001", seasonId);
    if (task.status !== "Published") {
      throw new AppError("Task unavailable", "TASK_UNAVAILABLE", "T001 must be Published first.");
    }
    const end = nextUtcDate(activityDate);
    const rows = db.prepare(
      `SELECT message_id, user_id, channel_id, content, created_at_utc, reply_to_message_id
       FROM activity_messages
       WHERE season_id = ? AND deleted = 0
         AND created_at_utc >= ? AND created_at_utc < ?
       ORDER BY created_at_utc, message_id`
    ).all(
      seasonId,
      `${activityDate}T00:00:00.000Z`,
      `${end}T00:00:00.000Z`
    ) as ActivityRow[];

    if (!rows.length) {
      return { activityDate, messages: 0, users: 0, submissionsCreated: 0, skippedWeeklyLimit: 0 };
    }
    const response = await this.precheck.precheck({
      seasonId,
      activityDate,
      threshold: 5,
      basePoints: task.config.basePoints,
      topicDefinition: task.config.topicDefinition ?? task.config.description,
      reviewCriteria: task.config.reviewCriteria ?? task.config.requirements,
      disqualifiers: task.config.disqualifiers ?? [],
      positiveExamples: task.config.positiveExamples ?? [],
      negativeExamples: task.config.negativeExamples ?? [],
      messages: rows.map((row) => ({
        messageId: row.message_id,
        userId: row.user_id,
        channelId: row.channel_id,
        content: row.content,
        createdAtUtc: row.created_at_utc,
        replyToMessageId: row.reply_to_message_id ?? undefined
      }))
    });

    let created = 0;
    let skippedWeeklyLimit = 0;
    const sourceByMessageId = new Map(rows.map((row) => [row.message_id, row]));
    const transaction = db.transaction(() => {
      const updateMessage = db.prepare(
        `UPDATE activity_messages SET
           rule_status = ?, rule_flags_json = ?, ai_status = ?,
           relevance_score = ?, quality_score = ?, ai_reason = ?
         WHERE message_id = ?`
      );
      for (const user of response.users) {
        for (const message of user.messages) {
          updateMessage.run(
            message.ruleStatus,
            JSON.stringify(message.ruleFlags),
            message.aiStatus,
            message.relevanceScore ?? null,
            message.qualityScore ?? null,
            message.reason,
            message.messageId
          );
        }
        const existing = db.prepare(
          `SELECT submission_id FROM activity_daily_reviews
           WHERE season_id = ? AND user_id = ? AND activity_date = ?`
        ).get(seasonId, user.userId, activityDate);
        if (existing) continue;

        const submission = this.submissions.create(
          {
            taskId: "T001",
            userId: user.userId,
            summary: [
              `Daily activity precheck for ${activityDate} UTC.`,
              `Candidate messages: ${user.candidateMessages}.`,
              `Rule-passed messages: ${user.rulePassedMessages}.`,
              `AI-valid messages: ${user.aiValidMessages}.`,
              `Suggested points: ${user.suggestedPoints}.`
            ].join(" "),
            structuredData: {
              source: "daily_activity_precheck",
              activityDate,
              ...user,
              messageEvidence: user.messages.map((message) => {
                const source = sourceByMessageId.get(message.messageId);
                return {
                  ...message,
                  channelId: source?.channel_id,
                  content: source?.content,
                  createdAtUtc: source?.created_at_utc
                };
              })
            }
          },
          seasonId,
          task.currentVersion
        );
        const precheckResult: PrecheckResult = {
          pluginId: "daily_activity_v1",
          score: user.recommendation === "pass" ? 90 : user.recommendation === "review" ? 60 : 30,
          recommendation: user.recommendation,
          flags: user.flags,
          missingItems: user.flags.includes("daily_threshold_not_met")
            ? ["At least five valid topic-related messages in the UTC day"]
            : [],
          reviewQuestions: user.reviewQuestions,
          raw: user
        };
        this.submissions.updateStatus(submission.id, "Prechecked", { aiPrecheck: precheckResult });
        db.prepare(
          `UPDATE submissions SET created_at = ?, updated_at = ? WHERE id = ?`
        ).run(`${activityDate} 23:59:59`, `${activityDate} 23:59:59`, submission.id);
        db.prepare(
          `INSERT INTO activity_daily_reviews
            (season_id, user_id, activity_date, submission_id, candidate_messages,
             rule_passed_messages, ai_valid_messages, suggested_points)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          seasonId,
          user.userId,
          activityDate,
          submission.id,
          user.candidateMessages,
          user.rulePassedMessages,
          user.aiValidMessages,
          user.suggestedPoints
        );
        created += 1;
      }
    });
    transaction();
    return {
      activityDate,
      messages: rows.length,
      users: response.users.length,
      submissionsCreated: created,
      skippedWeeklyLimit
    };
  }
}
