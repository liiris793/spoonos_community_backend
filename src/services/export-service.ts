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
  | "task_configs"
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
      case "task_configs": {
        const rows = db
          .prepare(
            `SELECT t.status, v.config_json
             FROM tasks t
             JOIN task_versions v
               ON v.task_id = t.id
              AND v.season_id = t.season_id
              AND v.version = t.current_version
             WHERE t.season_id = ?
             ORDER BY t.id`
          )
          .all(seasonId) as Array<{ status: string; config_json: string }>;

        const list = (value: unknown): string =>
          Array.isArray(value) ? value.join(" | ") : "";
        const limits = (value: unknown, key: string): string => {
          if (!value || typeof value !== "object") return "";
          const result = (value as Record<string, unknown>)[key];
          return result == null ? "" : String(result);
        };

        return rows.map(({ status, config_json }) => {
          const config = JSON.parse(config_json) as Record<string, unknown>;
          const taskLimits = config.limits;
          return {
            task_id: config.id,
            title: config.title,
            type: config.type,
            difficulty: config.difficulty,
            description: config.description,
            base_points: config.basePoints,
            min_points: config.minPoints ?? "",
            max_points: config.maxPoints ?? "",
            status,
            review_mode: config.reviewMode,
            claim_required: config.claimRequired,
            revision_allowed: config.revisionAllowed,
            per_day: limits(taskLimits, "perDay"),
            per_week: limits(taskLimits, "perWeek"),
            per_month: limits(taskLimits, "perMonth"),
            per_season: limits(taskLimits, "perSeason"),
            requirements: list(config.requirements),
            submission_fields: list(config.submissionFields),
            ai_precheck: Array.isArray(config.pluginIds)
              ? config.pluginIds.includes("ai_webhook_precheck")
              : false,
            precheck_pipeline: config.precheckPipeline ?? "",
            review_criteria: list(config.reviewCriteria),
            required_evidence: list(config.requiredEvidence),
            disqualifiers: list(config.disqualifiers),
            topic_definition: config.topicDefinition ?? "",
            positive_examples: list(config.positiveExamples),
            negative_examples: list(config.negativeExamples),
            allowed_channel_ids: list(config.allowedChannelIds),
            target_accounts: list(config.targetAccounts),
            target_post_ids: list(config.targetPostIds),
            opens_at: config.opensAt ?? "",
            closes_at: config.closesAt ?? ""
          };
        });
      }
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
