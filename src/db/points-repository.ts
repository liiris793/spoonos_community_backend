import { db } from "./database.js";
import { newId } from "./utils.js";
import type { PointLedgerEntry } from "../core/types.js";

export class PointsRepository {
  add(entry: Omit<PointLedgerEntry, "id" | "createdAt">): PointLedgerEntry {
    const id = newId("pts");
    db.prepare(
      `INSERT INTO point_ledger
        (id, season_id, user_id, task_id, submission_id, base_points,
         multiplier, points, reason, operator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      entry.seasonId,
      entry.userId,
      entry.taskId ?? null,
      entry.submissionId ?? null,
      entry.basePoints,
      entry.multiplier,
      entry.points,
      entry.reason,
      entry.operatorId
    );
    return db
      .prepare(
        `SELECT id, season_id AS seasonId, user_id AS userId,
          task_id AS taskId, submission_id AS submissionId,
          base_points AS basePoints, multiplier, points, reason,
          operator_id AS operatorId, created_at AS createdAt
         FROM point_ledger WHERE id = ?`
      )
      .get(id) as PointLedgerEntry;
  }

  total(seasonId: string, userId: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS total
         FROM point_ledger WHERE season_id = ? AND user_id = ?`
      )
      .get(seasonId, userId) as { total: number };
    return row.total;
  }

  totalForTask(seasonId: string, userId: string, taskId: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(points), 0) AS total
         FROM point_ledger
         WHERE season_id = ? AND user_id = ? AND task_id = ?`
      )
      .get(seasonId, userId, taskId) as { total: number };
    return row.total;
  }

  leaderboard(
    seasonId: string,
    limit: number | null = 10
  ): { userId: string; points: number; rank: number }[] {
    const limitClause = limit === null ? "" : "LIMIT ?";
    const rows = db
      .prepare(
        `SELECT user_id AS userId, SUM(points) AS points
         FROM point_ledger
         WHERE season_id = ?
         GROUP BY user_id
         ORDER BY points DESC, user_id ASC
         ${limitClause}`
      )
      .all(...(limit === null ? [seasonId] : [seasonId, limit])) as {
      userId: string;
      points: number;
    }[];
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }

  entries(seasonId: string, userId?: string): PointLedgerEntry[] {
    return db
      .prepare(
        `SELECT id, season_id AS seasonId, user_id AS userId,
          task_id AS taskId, submission_id AS submissionId,
          base_points AS basePoints, multiplier, points, reason,
          operator_id AS operatorId, created_at AS createdAt
         FROM point_ledger
         WHERE season_id = ?
           ${userId ? "AND user_id = ?" : ""}
         ORDER BY created_at DESC`
      )
      .all(...(userId ? [seasonId, userId] : [seasonId])) as PointLedgerEntry[];
  }
}
