import { beforeEach, describe, expect, it } from "vitest";
import { db, migrate } from "../src/db/database.js";
import { TaskImportService } from "../src/services/task-import-service.js";
import { TaskService } from "../src/services/task-service.js";

beforeEach(() => {
  migrate();
  db.exec(`
    DELETE FROM audit_logs;
    DELETE FROM task_versions;
    DELETE FROM tasks;
    DELETE FROM seasons;
  `);
  db.prepare(
    "INSERT INTO seasons (id, name, status) VALUES (?, ?, 'Active')"
  ).run("test-season", "Test Season");
});

describe("task table import", () => {
  it("creates and updates a complete task by task_id", () => {
    const importer = new TaskImportService();
    const first = Buffer.from(
      [
        "task_id,title,type,difficulty,description,base_points,status,review_mode,per_week,per_season,requirements",
        'T100,Weekly AI Insight,Community,Standard,"Share a source and your own analysis.",40,Draft,rules_then_human,2,8,"Original source | Personal analysis"'
      ].join("\n")
    );
    const parsed = importer.parse(first, "tasks.csv", "test-season");
    const created = importer.apply(parsed, "test-season", "admin");

    expect(created.created).toEqual(["T100"]);
    const task = new TaskService().get("T100", "test-season");
    expect(task.config.description).toBe(
      "Share a source and your own analysis."
    );
    expect(task.config.limits).toEqual({ perWeek: 2, perSeason: 8 });
    expect(task.config.requirements).toEqual([
      "Original source",
      "Personal analysis"
    ]);
    expect(new TaskService().list("test-season")).toHaveLength(1);
    expect(new TaskService().listPublished("test-season")).toHaveLength(0);

    const update = Buffer.from(
      [
        "task_id,title,type,difficulty,description,base_points,status,review_mode,per_week,requirements",
        'T100,Weekly AI Research,Community,Advanced,"Publish a reproducible weekly research note.",120,Published,ai_then_human,1,"Sources | Reproduction steps | Original analysis"'
      ].join("\n")
    );
    const updated = importer.apply(
      importer.parse(update, "tasks.csv", "test-season"),
      "test-season",
      "admin"
    );

    expect(updated.updated).toEqual(["T100"]);
    const current = new TaskService().get("T100", "test-season");
    expect(current.currentVersion).toBe(2);
    expect(current.status).toBe("Published");
    expect(current.config.basePoints).toBe(120);
    expect(current.config.difficulty).toBe("Advanced");
    expect(new TaskService().listPublished("test-season")).toHaveLength(1);
  });

  it("rejects missing descriptions and non-English user copy", () => {
    const importer = new TaskImportService();
    expect(() =>
      importer.parse(
        Buffer.from(
          "task_id,title,type,difficulty,description,base_points\nT101,中文任务,Community,Quick,,20"
        ),
        "tasks.csv",
        "test-season"
      )
    ).toThrow(/row 2/i);
  });
});
