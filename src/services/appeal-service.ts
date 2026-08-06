import { db } from "../db/database.js";
import { newId } from "../db/utils.js";

export class AppealService {
  create(
    seasonId: string,
    userId: string,
    reason: string,
    submissionId?: string
  ): string {
    const id = newId("appeal");
    db.prepare(
      `INSERT INTO appeals
        (id, season_id, user_id, submission_id, reason)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, seasonId, userId, submissionId ?? null, reason);
    return id;
  }

  next(seasonId: string):
    | {
        id: string;
        userId: string;
        submissionId?: string;
        reason: string;
        createdAt: string;
      }
    | undefined {
    const row = db
      .prepare(
        `SELECT id, user_id AS userId, submission_id AS submissionId,
                reason, created_at AS createdAt
         FROM appeals
         WHERE season_id = ? AND status = 'Open'
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(seasonId) as
      | {
          id: string;
          userId: string;
          submissionId?: string;
          reason: string;
          createdAt: string;
        }
      | undefined;
    return row;
  }

  resolve(
    appealId: string,
    status: "Upheld" | "Rejected",
    resolution: string,
    resolverId: string
  ): void {
    db.prepare(
      `UPDATE appeals
       SET status = ?, resolution = ?, resolver_id = ?,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'Open'`
    ).run(status, resolution, resolverId, appealId);
  }
}
