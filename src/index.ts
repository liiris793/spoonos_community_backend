import { config } from "./config.js";
import { createBot } from "./discord/bot.js";
import { seed } from "./scripts/seed.js";
import { PluginRegistry } from "./plugins/registry.js";
import { RuleBasedPrecheckPlugin } from "./plugins/rule-based-precheck.js";
import { WebhookAiPrecheckPlugin } from "./plugins/webhook-ai-precheck.js";
import { TaskService } from "./services/task-service.js";
import { SubmissionService } from "./services/submission-service.js";
import { TaskImportService } from "./services/task-import-service.js";
import { PointsService } from "./services/points-service.js";
import { ExportService } from "./services/export-service.js";
import { ActivityService } from "./services/activity-service.js";
import { BatchReviewService } from "./services/batch-review-service.js";
import { startPublicApi } from "./http/public-api.js";
import { ActivityPrecheckClient } from "./services/activity-precheck-client.js";
import { setTimeout as delay } from "node:timers/promises";
import { Events } from "discord.js";

seed();

const plugins = new PluginRegistry();
plugins.register(new RuleBasedPrecheckPlugin());
const submissionPrecheckUrl = config.precheckServiceUrl
  ? `${config.precheckServiceUrl.replace(/\/$/, "")}/precheck`
  : config.aiPrecheckWebhookUrl;
if (submissionPrecheckUrl) {
  plugins.register(
    new WebhookAiPrecheckPlugin(
      submissionPrecheckUrl,
      config.precheckServiceToken ?? config.aiPrecheckWebhookToken
    )
  );
}

const tasks = new TaskService();
const activity = new ActivityService(
  tasks,
  new ActivityPrecheckClient(
    config.precheckServiceUrl,
    config.precheckServiceToken
  ),
  undefined,
  config.activityChannelIds
);
const points = new PointsService();
const submissions = new SubmissionService(plugins, tasks);
const bot = createBot({
  tasks,
  submissions,
  taskImports: new TaskImportService(tasks),
  points,
  exports: new ExportService(),
  activity,
  batchReviews: new BatchReviewService(submissions)
});

async function loginToDiscord(token: string, timeoutMs = 30_000): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  let readyHandler: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyHandler = () => resolve();
    bot.once(Events.ClientReady, readyHandler);
    timeout = setTimeout(() => {
      bot.destroy();
      reject(
        new Error(
          `Discord login did not reach ready within ${timeoutMs / 1000} seconds`
        )
      );
    }, timeoutMs);
  });
  try {
    // discord.js login() may resolve before the Gateway emits ClientReady.
    // Wait for both so the outer retry loop never starts overlapping sessions.
    await Promise.all([bot.login(token), readyPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (readyHandler) bot.off(Events.ClientReady, readyHandler);
  }
}

if (!config.discordToken) {
  console.log(
    "Database and seed are ready. Set DISCORD_TOKEN, then run npm start."
  );
} else {
  let attempt = 0;
  while (!bot.isReady()) {
    try {
      console.log(
        `Connecting to Discord${attempt ? ` (retry ${attempt})` : ""}...`
      );
      await loginToDiscord(config.discordToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/invalid token|401|unauthorized/i.test(message)) {
        throw error;
      }
      attempt += 1;
      const retrySeconds = Math.min(30, 5 * attempt);
      console.error(
        `Discord connection failed (${message}). Retrying in ${retrySeconds}s...`
      );
      await delay(retrySeconds * 1000);
    }
  }
}

if (config.publicApiEnabled) {
  startPublicApi({ client: bot, tasks, points });
}

const precheckRecentDays = async (): Promise<void> => {
  if (
    tasks.get("T001", config.defaultSeasonId).status !== "Published" ||
    !activity.allowedChannelIds(config.defaultSeasonId).length
  ) {
    return;
  }
  const todayUtc = new Date().toISOString().slice(0, 10);
  for (let i = config.precheckLookbackDays; i >= 1; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (date >= todayUtc) continue;
    try {
      const result = await activity.prepareDailyReview(
        config.defaultSeasonId,
        date
      );
      if (result.submissionsCreated) {
        console.log(
          `Prepared ${result.submissionsCreated} daily activity review(s) for ${date} UTC.`
        );
      } else {
        console.log(`No new submissions for ${date} UTC (already reviewed or no qualifying messages).`);
      }
    } catch (error) {
      console.error(`Daily activity precheck failed for ${date} UTC`, error);
    }
  }
};

const scheduleDailyPrecheck = (): void => {
  const now = Date.now();
  const nextUtcMidnight = new Date(Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
    0, 0, 0, 0
  )).getTime();
  const msUntilMidnight = nextUtcMidnight - now;

  setTimeout(async () => {
    await precheckRecentDays();
    scheduleDailyPrecheck();
  }, msUntilMidnight).unref();
};

if (config.precheckServiceUrl) {
  void precheckRecentDays();
  scheduleDailyPrecheck();
}
