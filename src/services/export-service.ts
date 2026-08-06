import { db } from "../db/database.js";

const escapeCsv = (value: unknown): string => {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))
  ].join("\n");
}

export type ExportType =
  | "users"
  | "tasks"
  | "submissions"
  | "points"
  | "content";

export class ExportService {
  export(seasonId: string, type: ExportType): string {
    const rows = this.rows(seasonId, type);
    return `\uFEFF${toCsv(rows)}`;
  }

  private rows(seasonId: string, type: ExportType): Record<string, unknown>[] {
    switch (type) {
      case "users":
        return db
          .prepare(
            `SELECT p.user_id AS user_id,
                    p.points AS total_points,
                    COUNT(DISTINCT s.id) AS submissions,
                    SUM(CASE WHEN s.status = 'Approved' THEN 1 ELSE 0 END) AS approved,
                    COUNT(DISTINCT substr(s.created_at, 1, 10)) AS active_days
             FROM (
               SELECT user_id, SUM(points) AS points
               FROM point_ledger WHERE season_id = ? GROUP BY user_id
             ) p
             LEFT JOIN submissions s
               ON s.season_id = ? AND s.user_id = p.user_id
             GROUP BY p.user_id, p.points
             ORDER BY p.points DESC`
          )
          .all(seasonId, seasonId) as Record<string, unknown>[];
      case "tasks":
        return db
          .prepare(
            `SELECT t.id AS task_id, t.status, t.current_version,
                    json_extract(v.config_json, '$.title') AS title,
                    json_extract(v.config_json, '$.type') AS type,
                    json_extract(v.config_json, '$.difficulty') AS difficulty,
                    json_extract(v.config_json, '$.basePoints') AS base_points,
                    COUNT(s.id) AS submissions,
                    SUM(CASE WHEN s.status = 'Approved' THEN 1 ELSE 0 END) AS approved,
                    SUM(COALESCE(s.final_points, 0)) AS awarded_points
             FROM tasks t
             JOIN task_versions v
               ON v.task_id = t.id AND v.season_id = t.season_id
              AND v.version = t.current_version
             LEFT JOIN submissions s
               ON s.task_id = t.id AND s.season_id = t.season_id
             WHERE t.season_id = ?
             GROUP BY t.id, t.status, t.current_version, v.config_json
             ORDER BY t.id`
          )
          .all(seasonId) as Record<string, unknown>[];
      case "submissions":
        return db
          .prepare(
            `SELECT id, user_id, task_id, task_version, status, summary,
                    proof_url, attachment_url, ai_precheck_json,
                    reviewer_id, review_note, quality_coefficient,
                    final_points, created_at, updated_at
             FROM submissions WHERE season_id = ? ORDER BY created_at`
          )
          .all(seasonId) as Record<string, unknown>[];
      case "points":
        return db
          .prepare(
            `SELECT id, user_id, task_id, submission_id, base_points,
                    multiplier, points, reason, operator_id, created_at
             FROM point_ledger WHERE season_id = ? ORDER BY created_at`
          )
          .all(seasonId) as Record<string, unknown>[];
      case "content":
        return db
          .prepare(
            `SELECT s.id, s.user_id, s.task_id,
                    json_extract(v.config_json, '$.title') AS task_title,
                    json_extract(v.config_json, '$.difficulty') AS difficulty,
                    s.summary, s.proof_url, s.attachment_url,
                    s.quality_coefficient, s.final_points, s.created_at
             FROM submissions s
             JOIN task_versions v
               ON v.task_id = s.task_id
              AND v.season_id = s.season_id
              AND v.version = s.task_version
             WHERE s.season_id = ? AND s.status = 'Approved'
               AND (
                 json_extract(v.config_json, '$.difficulty') IN ('Advanced', 'Bounty')
                 OR s.quality_coefficient > 1
               )
             ORDER BY s.final_points DESC`
          )
          .all(seasonId) as Record<string, unknown>[];
    }
  }
}
