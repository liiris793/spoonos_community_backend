import { db, migrate } from "../db/database.js";
import { TaskRepository } from "../db/task-repository.js";
import { season2Tasks } from "../data/season2-tasks.js";

export function seed(): void {
  migrate();
  db.prepare(
    `INSERT INTO seasons (id, name, status, starts_at, ends_at)
     VALUES (?, ?, 'Draft', ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(
    "season-2",
    "SpoonOS Community Contribution Program · Season 2",
    "2026-08-10T00:00:00Z",
    "2026-10-10T23:59:59Z"
  );

  const repository = new TaskRepository();
  let created = 0;
  let translated = 0;
  let precheckUpdated = 0;
  for (const task of season2Tasks) {
    const existing = repository.get(task.id, task.seasonId);
    if (!existing) {
      repository.create(task, "seed");
      created += 1;
    } else {
      const needsTranslation = [
        existing.config.title,
        existing.config.description,
        ...existing.config.requirements
      ].some((value) => /[\u3400-\u9fff]/u.test(value));
      const needsPrecheckConfig =
        !existing.config.precheckPipeline ||
        !existing.config.reviewCriteria ||
        (["T005", "T006", "T012", "T022"].includes(task.id) &&
          !existing.config.pluginIds.includes("ai_webhook_precheck"));
      if (!needsTranslation && !needsPrecheckConfig) continue;
      repository.update(
        task.id,
        task.seasonId,
        {
          ...(needsTranslation
            ? {
                title: task.title,
                description: task.description,
                requirements: task.requirements
              }
            : {}),
          ...(needsPrecheckConfig
            ? {
                precheckPipeline: task.precheckPipeline,
                reviewCriteria: task.reviewCriteria,
                requiredEvidence: task.requiredEvidence,
                disqualifiers: task.disqualifiers,
                topicDefinition: task.topicDefinition,
                positiveExamples: task.positiveExamples,
                negativeExamples: task.negativeExamples,
                pluginIds: task.pluginIds,
                reviewMode: task.reviewMode
              }
            : {})
        },
        needsTranslation ? "seed:english-and-precheck" : "seed:precheck-config"
      );
      if (needsTranslation) translated += 1;
      if (needsPrecheckConfig) precheckUpdated += 1;
    }
  }
  console.log(
    `Seed complete. Created ${created} task(s); updated ${translated} task(s) to English; configured ${precheckUpdated} task(s) for precheck.`
  );
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed();
}
