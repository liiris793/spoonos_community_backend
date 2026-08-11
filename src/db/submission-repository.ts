import { db } from "./database.js";
import { newId, parseJson } from "./utils.js";
import type {
  PrecheckResult,
  SubmissionInput,
  SubmissionRecord,
  SubmissionStatus
} from "../core/types.js";

type SubmissionRow = {
  id: string;
  season_id: string;
  task_id: string;
  task_version: number;
  user_id: string;
  summary: string;
  proof_url: string | null;
  attachment_url: string | null;
  structured_data_json: string | null;
  status: SubmissionStatus;
  ai_precheck_json: string | null;
  reviewer_id: string | null;
  review_note: string | null;
  quality_coefficient: number | null;
  final_points: number | null;
  created_at: string;
  updated_at: string;
};

const rowToSubmission = (row: SubmissionRow): SubmissionRecord => ({
  id: row.id,
  seasonId: row.season_id,
  taskId: row.task_id,
  taskVersion: row.task_version,
  userId: row.user_id,
  summary: row.summary,
  proofUrl: row.proof_url ?? undefined,
  attachmentUrl: row.attachment_url ?? undefined,
  structuredData: parseJson(row.structured_data_json),
  status: row.status,
  aiPrecheck: parseJson<PrecheckResult>(row.ai_precheck_json),
  reviewerId: row.reviewer_id ?? undefined,
  reviewNote: row.review_note ?? undefined,
  qualityCoefficient: row.quality_coefficient ?? undefined,
  finalPoints: row.final_points ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export class SubmissionRepository {
  create(
    input: SubmissionInput,
    seasonId: string,
    taskVersion: number
  ): SubmissionRecord {
    const id = newId("sub");
    db.prepare(
      `INSERT INTO submissions
        (id, season_id, task_id, task_version, user_id, summary,
         proof_url, attachment_url, structured_data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      seasonId,
      input.taskId,
      taskVersion,
      input.userId,
      input.summary,
      input.proofUrl ?? null,
      input.attachmentUrl ?? null,
      input.structuredData ? JSON.stringify(input.structuredData) : null
    );
    return this.get(id)!;
  }

  get(id: string): SubmissionRecord | undefined {
    const row = db
      .prepare("SELECT * FROM submissions WHERE id = ? COLLATE NOCASE")
      .get(id) as SubmissionRow | undefined;
    return row ? rowToSubmission(row) : undefined;
  }

  updateStatus(
    id: string,
    status: SubmissionStatus,
    fields: {
      aiPrecheck?: PrecheckResult;
      reviewerId?: string;
      reviewNote?: string;
      qualityCoefficient?: number;
      finalPoints?: number;
    } = {}
  ): SubmissionRecord {
    db.prepare(
      `UPDATE submissions
       SET status = ?,
           ai_precheck_json = COALESCE(?, ai_precheck_json),
           reviewer_id = COALESCE(?, reviewer_id),
           review_note = COALESCE(?, review_note),
           quality_coefficient = COALESCE(?, quality_coefficient),
           final_points = COALESCE(?, final_points),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      status,
      fields.aiPrecheck ? JSON.stringify(fields.aiPrecheck) : null,
      fields.reviewerId ?? null,
      fields.reviewNote ?? null,
      fields.qualityCoefficient ?? null,
      fields.finalPoints ?? null,
      id
    );
    return this.get(id)!;
  }

  updatePrecheck(id: string, aiPrecheck: PrecheckResult): SubmissionRecord {
    db.prepare(
      `UPDATE submissions
       SET ai_precheck_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(JSON.stringify(aiPrecheck), id);
    return this.get(id)!;
  }

  listForReview(limit = 20): SubmissionRecord[] {
    const rows = db
      .prepare(
        `SELECT * FROM submissions
         WHERE status IN ('Submitted', 'Prechecked', 'UnderReview', 'Appealed')
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(limit) as SubmissionRow[];
    return rows.map(rowToSubmission);
  }

  listByUser(seasonId: string, userId: string): SubmissionRecord[] {
    const rows = db
      .prepare(
        `SELECT * FROM submissions
         WHERE season_id = ? AND user_id = ?
         ORDER BY created_at DESC`
      )
      .all(seasonId, userId) as SubmissionRow[];
    return rows.map(rowToSubmission);
  }

  listRecentTexts(
    seasonId: string,
    taskId: string,
    limit = 100,
    excludeSubmissionId?: string
  ): string[] {
    const rows = db
      .prepare(
        `SELECT summary FROM submissions
         WHERE season_id = ? AND task_id = ?
           ${excludeSubmissionId ? "AND id <> ?" : ""}
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(
        ...(excludeSubmissionId
          ? [seasonId, taskId, excludeSubmissionId, limit]
          : [seasonId, taskId, limit])
      ) as { summary: string }[];
    return rows.map((row) => row.summary);
  }

  countCounted(
    seasonId: string,
    taskId: string,
    userId: string,
    since?: string
  ): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM submissions
         WHERE season_id = ? AND task_id = ? AND user_id = ?
           AND status IN ('Submitted', 'Prechecked', 'UnderReview', 'Approved', 'Appealed')
           ${since ? "AND created_at >= ?" : ""}`
      )
      .get(...(since ? [seasonId, taskId, userId, since] : [seasonId, taskId, userId])) as {
      count: number;
    };
    return row.count;
  }
}
