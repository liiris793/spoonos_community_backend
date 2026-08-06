import { db } from "../db/database.js";
import { newId } from "../db/utils.js";
import { TaskRepository } from "../db/task-repository.js";
import type { TaskConfig, TaskRecord, TaskStatus } from "../core/types.js";
import { AppError } from "../core/errors.js";

export class TaskService {
  constructor(private readonly tasks = new TaskRepository()) {}

  find(taskId: string, seasonId: string): TaskRecord | undefined {
    return this.tasks.get(taskId, seasonId);
  }

  list(
    seasonId: string,
    filters: { type?: string; difficulty?: string } = {}
  ): TaskRecord[] {
    return this.tasks.list(seasonId).filter((task) => {
      if (filters.type && task.config.type !== filters.type) return false;
      if (
        filters.difficulty &&
        task.config.difficulty !== filters.difficulty
      ) {
        return false;
      }
      return true;
    });
  }

  listPublished(
    seasonId: string,
    filters: { type?: string; difficulty?: string } = {}
  ): TaskRecord[] {
    return this.list(seasonId, filters).filter((task) => {
      if (task.status !== "Published") return false;
      return true;
    });
  }

  get(taskId: string, seasonId: string): TaskRecord {
    const task = this.tasks.get(taskId, seasonId);
    if (!task) {
      throw new AppError("Task not found", "TASK_NOT_FOUND");
    }
    return task;
  }

  create(config: TaskConfig, actorId: string): TaskRecord {
    return this.tasks.create(config, actorId);
  }

  update(
    taskId: string,
    seasonId: string,
    patch: Partial<TaskConfig>,
    actorId: string
  ): TaskRecord {
    return this.tasks.update(taskId, seasonId, patch, actorId);
  }

  setStatus(
    taskId: string,
    seasonId: string,
    status: TaskStatus,
    actorId: string
  ): TaskRecord {
    return this.update(taskId, seasonId, { status }, actorId);
  }

  clone(
    sourceId: string,
    sourceSeasonId: string,
    targetId: string,
    targetSeasonId: string,
    actorId: string
  ): TaskRecord {
    return this.tasks.clone(
      sourceId,
      sourceSeasonId,
      targetId,
      targetSeasonId,
      actorId
    );
  }

  claim(taskId: string, seasonId: string, userId: string): string {
    const task = this.get(taskId, seasonId);
    if (task.status !== "Published") {
      throw new AppError("Task unavailable", "TASK_UNAVAILABLE");
    }
    if (!task.config.claimRequired) {
      return "This task does not require a claim. You can submit it directly.";
    }

    const existing = db
      .prepare(
        `SELECT id FROM claims
         WHERE season_id = ? AND task_id = ? AND user_id = ? AND status = 'Active'`
      )
      .get(seasonId, taskId, userId) as { id: string } | undefined;
    if (existing) return "You have already claimed this task.";

    db.prepare(
      `INSERT INTO claims
        (id, season_id, task_id, task_version, user_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run(newId("claim"), seasonId, taskId, task.currentVersion, userId);
    return `Claimed ${task.id} | ${task.config.title}`;
  }
}
