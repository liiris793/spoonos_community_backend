import { db } from "./database.js";
import type { TaskConfig, TaskRecord, TaskStatus } from "../core/types.js";
import { AppError } from "../core/errors.js";
import { newId } from "./utils.js";

type TaskRow = {
  id: string;
  season_id: string;
  status: TaskStatus;
  current_version: number;
  config_json: string;
};

const rowToTask = (row: TaskRow): TaskRecord => ({
  id: row.id,
  seasonId: row.season_id,
  status: row.status,
  currentVersion: row.current_version,
  config: JSON.parse(row.config_json) as TaskConfig
});

export class TaskRepository {
  get(taskId: string, seasonId: string): TaskRecord | undefined {
    const row = db
      .prepare(
        `SELECT t.id, t.season_id, t.status, t.current_version, v.config_json
         FROM tasks t
         JOIN task_versions v
           ON v.task_id = t.id
          AND v.season_id = t.season_id
          AND v.version = t.current_version
         WHERE t.id = ? AND t.season_id = ?`
      )
      .get(taskId, seasonId) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  list(seasonId: string, includeArchived = false): TaskRecord[] {
    const rows = db
      .prepare(
        `SELECT t.id, t.season_id, t.status, t.current_version, v.config_json
         FROM tasks t
         JOIN task_versions v
           ON v.task_id = t.id
          AND v.season_id = t.season_id
          AND v.version = t.current_version
         WHERE t.season_id = ?
           ${includeArchived ? "" : "AND t.status <> 'Archived'"}
         ORDER BY t.id`
      )
      .all(seasonId) as TaskRow[];
    return rows.map(rowToTask);
  }

  create(config: TaskConfig, actorId: string): TaskRecord {
    if (this.get(config.id, config.seasonId)) {
      throw new AppError(
        "Task already exists",
        "TASK_EXISTS",
        `Task ID ${config.id} already exists. Use /task-admin edit or import the row again to update it.`
      );
    }

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO tasks (id, season_id, status, current_version)
         VALUES (?, ?, ?, 1)`
      ).run(config.id, config.seasonId, config.status);
      db.prepare(
        `INSERT INTO task_versions
          (task_id, season_id, version, config_json, created_by)
         VALUES (?, ?, 1, ?, ?)`
      ).run(config.id, config.seasonId, JSON.stringify(config), actorId);
      this.audit(actorId, "task.create", "task", config.id, undefined, config);
    });
    transaction();
    return this.get(config.id, config.seasonId)!;
  }

  update(
    taskId: string,
    seasonId: string,
    patch: Partial<TaskConfig>,
    actorId: string
  ): TaskRecord {
    const current = this.get(taskId, seasonId);
    if (!current) {
      throw new AppError("Task not found", "TASK_NOT_FOUND");
    }
    if (current.status === "Archived") {
      throw new AppError(
        "Archived task cannot be edited",
        "TASK_ARCHIVED",
        "Archived tasks cannot be edited. Clone it to a new Task ID instead."
      );
    }

    const nextVersion = current.currentVersion + 1;
    const nextConfig: TaskConfig = {
      ...current.config,
      ...patch,
      id: taskId,
      seasonId,
      status: patch.status ?? current.status
    };

    const transaction = db.transaction(() => {
      db.prepare(
        `INSERT INTO task_versions
          (task_id, season_id, version, config_json, created_by)
         VALUES (?, ?, ?, ?, ?)`
      ).run(taskId, seasonId, nextVersion, JSON.stringify(nextConfig), actorId);
      db.prepare(
        `UPDATE tasks
         SET status = ?, current_version = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND season_id = ?`
      ).run(nextConfig.status, nextVersion, taskId, seasonId);
      this.audit(
        actorId,
        "task.update",
        "task",
        taskId,
        current.config,
        nextConfig
      );
    });
    transaction();
    return this.get(taskId, seasonId)!;
  }

  clone(
    sourceId: string,
    sourceSeasonId: string,
    targetId: string,
    targetSeasonId: string,
    actorId: string
  ): TaskRecord {
    const source = this.get(sourceId, sourceSeasonId);
    if (!source) {
      throw new AppError("Source task not found", "TASK_NOT_FOUND");
    }
    return this.create(
      {
        ...source.config,
        id: targetId,
        seasonId: targetSeasonId,
        status: "Draft"
      },
      actorId
    );
  }

  private audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before?: unknown,
    after?: unknown
  ): void {
    db.prepare(
      `INSERT INTO audit_logs
        (id, actor_id, action, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId("audit"),
      actorId,
      action,
      entityType,
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null
    );
  }
}
