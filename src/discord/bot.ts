import {
  ActionRowBuilder,
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { ProxyAgent, Agent, setGlobalDispatcher } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createRequire } from "node:module";
import { config } from "../config.js";
import { AppError } from "../core/errors.js";
import type {
  TaskConfig,
  TaskDifficulty,
  ReviewMode,
  TaskStatus,
  TaskType
} from "../core/types.js";
import { SubmissionRepository } from "../db/submission-repository.js";
import { ActivityService } from "../services/activity-service.js";
import { BatchReviewService } from "../services/batch-review-service.js";
import { ExportService, type ExportType } from "../services/export-service.js";
import { PointsService } from "../services/points-service.js";
import { SubmissionService } from "../services/submission-service.js";
import { TaskImportService } from "../services/task-import-service.js";
import { TaskService } from "../services/task-service.js";
import { canManageTasks, canReview } from "./permissions.js";
import {
  announcementEmbed,
  reviewButtons,
  reviewEmbed,
  taskButtons,
  taskEmbed
} from "./presenters.js";

type Dependencies = {
  tasks: TaskService;
  submissions: SubmissionService;
  taskImports: TaskImportService;
  points: PointsService;
  exports: ExportService;
  activity: ActivityService;
  batchReviews: BatchReviewService;
};

export function createBot(deps: Dependencies): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  if (config.discordProxyUrl) {
    // REST API proxy (discord.js uses undici for REST requests)
    const restAgent = new ProxyAgent({
      uri: config.discordProxyUrl,
      requestTls: { timeout: 30_000 },
      proxyTls: { timeout: 30_000 }
    });
    client.rest.setAgent(restAgent);
    // Global fetch proxy — routes fetch() through proxy for external hosts
    // (Discord CDN downloads for task/review/announcement attachments)
    // but bypasses localhost for local service calls (127.0.0.1:8000 etc.)
    const fetchProxyAgent = new ProxyAgent({
      uri: config.discordProxyUrl,
      requestTls: { timeout: 30_000 },
      proxyTls: { timeout: 30_000 }
    });
    const directAgent = new Agent({ connect: { timeout: 10_000 } });
    setGlobalDispatcher({
      dispatch(options: any, handler: any) {
        const origin = String(options.origin || "");
        const isLocal =
          origin.includes("127.0.0.1") || origin.includes("localhost");
        return (isLocal ? directAgent : fetchProxyAgent).dispatch(
          options,
          handler
        );
      },
      close(cb?: any) {
        return (fetchProxyAgent as any).close(cb);
      },
      destroy(cb?: any) {
        return (fetchProxyAgent as any).destroy(cb);
      }
    } as any);
    // Gateway WebSocket proxy (ws library uses node https module, not undici)
    // Patch https.request via CJS require to inject proxy agent for WebSocket upgrade requests
    const wsAgent = new HttpsProxyAgent(config.discordProxyUrl);
    const nodeHttps = createRequire(import.meta.url)("node:https");
    const originalRequest = nodeHttps.request;
    nodeHttps.request = function (options: any, ...rest: any[]) {
      if (typeof options === "object" && options !== null && !options.agent) {
        const host =
          options.hostname ||
          (typeof options.host === "string" ? options.host.split(":")[0] : "");
        // Skip proxy for localhost connections
        if (host && !["127.0.0.1", "localhost"].includes(host)) {
          options = { ...options, agent: wsAgent };
        }
      }
      return originalRequest.call(this, options, ...rest);
    };
    const proxy = new URL(config.discordProxyUrl);
    console.log(`Discord proxy enabled (REST + Gateway + Fetch): ${proxy.hostname}:${proxy.port}`);
  }

  client.once(Events.ClientReady, () => {
    console.log(`Discord bot ready as ${client.user?.tag}`);
  });
  client.on(Events.Error, (error) => {
    console.error("Discord client error", error);
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || !message.guildId) return;
    deps.activity.recordMessage(
      config.defaultSeasonId,
      {
        messageId: message.id,
        userId: message.author.id,
        channelId: message.channelId,
        content: message.content,
        createdAtUtc: message.createdAt.toISOString(),
        replyToMessageId: message.reference?.messageId ?? undefined
      }
    );
  });

  client.on(Events.MessageDelete, (message) => {
    deps.activity.markDeleted(message.id);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, deps);
      } else if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, deps);
      } else if (interaction.isButton()) {
        await handleButton(interaction, deps);
      } else if (interaction.isModalSubmit()) {
        await handleModal(interaction, deps);
      }
    } catch (error) {
      const errorCode =
        typeof error === "object" && error && "code" in error
          ? String(error.code)
          : "";
      if (errorCode === "10062") {
        // Interaction already expired — any reply attempt will also fail and
        // just back up the REST queue, delaying legitimate commands.
        // Log and bail immediately.
        console.error(
          "Discord interaction expired before it could be acknowledged. " +
            "Check Discord REST proxy/network latency and try the command again."
        );
        return;
      }
      console.error(error);
      const message =
        error instanceof AppError
          ? error.userMessage
          : "The operation failed. Please contact an administrator.";
      if (interaction.isRepliable()) {
        try {
          if (interaction.deferred) {
            await interaction.editReply({ content: message });
          } else if (interaction.replied) {
            await interaction.followUp({
              content: message,
              flags: MessageFlags.Ephemeral
            });
          } else {
            await interaction.reply({
              content: message,
              flags: MessageFlags.Ephemeral
            });
          }
        } catch (responseError) {
          const code =
            typeof responseError === "object" &&
            responseError &&
            "code" in responseError
              ? String(responseError.code)
              : "";
          if (!["10062", "40060"].includes(code)) {
            console.error("Failed to send interaction error response", responseError);
          }
        }
      }
    }
  });

  return client;
}

async function handleAutocomplete(
  interaction: any,
  deps: Dependencies
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "batch_id") {
    await interaction.respond([]);
    return;
  }
  const batches = deps.batchReviews.listBatches();
  const query = String(focused.value).toLowerCase().trim();
  const choices = batches
    .filter(
      (b) =>
        !query ||
        b.id.toLowerCase().includes(query) ||
        b.startDate.includes(query) ||
        b.endDate.includes(query)
    )
    .slice(0, 25)
    .map((b) => ({
      name: `${b.id}  (${b.startDate} → ${b.endDate}, ${b.count} items${b.imported ? ", imported" : ""})`,
      value: b.id
    }));
  await interaction.respond(choices);
}

async function handleCommand(
  interaction: Extract<
    Parameters<Client["emit"]>[1],
    { isChatInputCommand(): true }
  > | any,
  deps: Dependencies
): Promise<void> {
  const seasonId = config.defaultSeasonId;

  if (interaction.commandName === "season") {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2563eb)
          .setTitle("SpoonOS Community Contribution Program · Season 2")
          .setDescription(
            "Complete missions, contribute content, and help build the community to earn season points and levels."
          )
          .addFields(
            { name: "Task center", value: "Use `/tasks`", inline: true },
            { name: "My progress", value: "Use `/me`", inline: true },
            {
              name: "Leaderboard",
              value: "Use `/leaderboard`",
              inline: true
            }
          )
      ],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "tasks") {
    if (!canManageTasks(interaction) && config.communityPortalUrl) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2563eb)
            .setTitle("SpoonOS Community Tasks")
            .setDescription(
              "Browse all published tasks, compare difficulty and points, and view the live Season 2 leaderboard."
            )
            .setURL(config.communityPortalUrl)
            .addFields({
              name: "Tasks & Leaderboard",
              value: `[Open the community portal](${config.communityPortalUrl})`
            })
            .setFooter({ text: "Portal data is provided by the SpoonOS Community Bot." })
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const type = interaction.options.getString("type") ?? undefined;
    const difficulty =
      interaction.options.getString("difficulty") ?? undefined;
    const isTaskManager = canManageTasks(interaction);
    const tasks = isTaskManager
      ? deps.tasks.list(seasonId, { type, difficulty })
      : deps.tasks.listPublished(seasonId, { type, difficulty });
    const lines = tasks.slice(0, 20).map(
      (task) =>
        `**${task.id}** · ${task.config.title} · ${task.config.basePoints} pts · ${
          task.config.difficulty
        }${isTaskManager ? ` · **${task.status}**` : ""}`
    );
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2563eb)
          .setTitle("Season 2 Task Center")
          .setDescription(
            lines.length
              ? `${lines.join("\n")}\n\nUse \`/task task_id:T018\` to view details.${
                  isTaskManager
                    ? "\nManagers can see every non-archived task. Members only see Published tasks."
                    : ""
                }`
              : "No tasks match these filters."
          )
      ],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "task") {
    const taskId = interaction.options.getString("task_id", true).toUpperCase();
    const task = deps.tasks.get(taskId, seasonId);
    await interaction.reply({
      embeds: [taskEmbed(task)],
      components: [taskButtons(task)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "submit") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const taskId = interaction.options.getString("task_id", true).toUpperCase();
    const attachment = interaction.options.getAttachment("attachment");
    const submission = await deps.submissions.submit(
      {
        taskId,
        userId: interaction.user.id,
        summary: interaction.options.getString("summary", true),
        proofUrl: interaction.options.getString("proof_url") ?? undefined,
        attachmentUrl: attachment?.url
      },
      seasonId
    );
    await interaction.editReply(
      `Submission received: \`${submission.id}\`\nStatus: ${submission.status}`
    );
    return;
  }

  if (interaction.commandName === "me") {
    const profile = deps.points.profile(seasonId, interaction.user.id);
    const recent = new SubmissionRepository()
      .listByUser(seasonId, interaction.user.id)
      .slice(0, 5)
      .map((item) => `${item.taskId} · ${item.status}`)
      .join("\n");
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2563eb)
          .setTitle(`${interaction.user.username}'s Season 2 Progress`)
          .addFields(
            {
              name: "Level",
              value: `Lv.${profile.level} ${profile.title}`,
              inline: true
            },
            { name: "Points", value: String(profile.total), inline: true },
            {
              name: "Next level",
              value: profile.nextAt
                ? `${profile.remaining} pts remaining`
                : "Maximum level reached",
              inline: true
            },
            { name: "Recent submissions", value: recent || "No submissions yet" }
          )
      ],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "leaderboard") {
    const rows = deps.points.leaderboard(seasonId, 10);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle("Season 2 Leaderboard")
          .setDescription(
            rows.length
              ? rows
                  .map(
                    (row) =>
                      `**#${row.rank}** <@${row.userId}> · ${row.points} pts`
                  )
                  .join("\n")
              : "There are no point records yet."
          )
          .setFooter({ text: "Final reward eligibility is subject to season review." })
      ]
    });
    return;
  }

  if (interaction.commandName === "announce") {
    if (!canManageTasks(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to publish community updates."
      );
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannel =
      interaction.options.getChannel("channel") ?? interaction.channel;
    if (
      !targetChannel ||
      !targetChannel.isTextBased() ||
      typeof targetChannel.send !== "function"
    ) {
      throw new AppError(
        "Invalid announcement channel",
        "INVALID_CHANNEL",
        "Select a text or announcement channel where the bot can send messages."
      );
    }

    const link = interaction.options.getString("link") ?? undefined;
    if (link) {
      try {
        const parsed = new URL(link);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        throw new AppError(
          "Invalid announcement link",
          "INVALID_URL",
          "The announcement link must be a valid http or https URL."
        );
      }
    }

    const contentFile = interaction.options.getAttachment("content_file");
    let content = interaction.options.getString("content")?.trim() ?? "";
    if (contentFile) {
      if (!/\.(md|txt)$/i.test(contentFile.name)) {
        throw new AppError(
          "Unsupported announcement file",
          "UNSUPPORTED_ANNOUNCEMENT_FILE",
          "The announcement content file must be .md or .txt."
        );
      }
      if (contentFile.size > 1024 * 1024) {
        throw new AppError(
          "Announcement file too large",
          "ANNOUNCEMENT_FILE_TOO_LARGE",
          "The announcement content file must be 1 MB or smaller."
        );
      }
      const response = await fetch(contentFile.url);
      if (!response.ok) {
        throw new AppError(
          "Announcement file download failed",
          "ANNOUNCEMENT_FILE_DOWNLOAD_FAILED",
          "The announcement content file could not be downloaded from Discord."
        );
      }
      content = Buffer.from(await response.arrayBuffer()).toString("utf8").trim();
    }
    if (!content) {
      throw new AppError(
        "Announcement content required",
        "ANNOUNCEMENT_CONTENT_REQUIRED",
        "Provide content or upload a .md/.txt content file."
      );
    }

    const image = interaction.options.getAttachment("image");
    const mentionEveryone =
      interaction.options.getBoolean("mention_everyone") ?? false;
    const sent = await targetChannel.send({
      content: mentionEveryone ? "@everyone" : undefined,
      embeds: [
        announcementEmbed({
          title: interaction.options.getString("title", true),
          content,
          link,
          imageUrl: image?.url
        })
      ],
      allowedMentions: {
        parse: mentionEveryone ? ["everyone"] : []
      }
    });

    await interaction.editReply({
      content: `Community update published: ${sent.url}`
    });
    return;
  }

  if (interaction.commandName === "points-admin") {
    if (!canManageTasks(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to manage points."
      );
    }
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const entry = deps.points.adjust(
      seasonId,
      target.id,
      amount,
      interaction.options.getString("reason", true),
      interaction.user.id,
      interaction.options.getString("task_id")?.toUpperCase()
    );
    await interaction.reply({
      content: `Point entry created: ${target} ${
        amount > 0 ? "+" : ""
      }${amount} pts\nEntry: \`${entry.id}\``,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "review") {
    if (!canReview(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to review submissions."
      );
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "list") {
      const batches = deps.batchReviews.listBatches();
      if (!batches.length) {
        await interaction.reply({
          content: "No review batches found.",
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: [
            "**Review Batches**",
            ...batches.map(
              (b) =>
                `• \`${b.id}\` — ${b.startDate} → ${b.endDate} | ${b.count} items${b.imported ? " | imported" : ""}`
            )
          ].join("\n"),
          flags: MessageFlags.Ephemeral
        });
      }
      return;
    }
    if (subcommand === "create-batch") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const batch = deps.batchReviews.createBatch(
        seasonId,
        interaction.user.id,
        {
          days: interaction.options.getInteger("days") ?? undefined,
          startDate: interaction.options.getString("start_date") ?? undefined,
          endDate: interaction.options.getString("end_date") ?? undefined
        }
      );
      console.log(
        `[review] Batch created: ${batch.batchId} | ${batch.startDate} → ${batch.endDate} | ${batch.count} submissions`
      );
      await interaction.editReply({
        content: [
          `Review batch created: \`${batch.batchId}\``,
          `UTC range: ${batch.startDate} → ${batch.endDate}`,
          `Submissions: ${batch.count}`,
          "The batch is now fixed. New submissions will not be added to it.",
          `Next: use \`/review ai-preview batch_id:${batch.batchId}\`.`
        ].join("\n")
      });
      return;
    }
    if (subcommand === "ai-preview") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const batchId = interaction.options.getString("batch_id", true);
      console.log(`[ai-preview] Starting for batch ${batchId}`);
      const result = await deps.batchReviews.previewBatch(
        batchId,
        interaction.options.getInteger("limit") ?? undefined
      );
      console.log(`[ai-preview] Done: processed=${result.processed}, succeeded=${result.succeeded}, remaining=${result.remaining}`);
      await interaction.editReply({
        content: [
          `AI preview updated: \`${result.batchId}\``,
          `Processed this run: ${result.processed}`,
          `Successful this run: ${result.succeeded}`,
          `Unavailable/failed this run: ${result.unavailable}`,
          `Batch progress: ${result.previewedTotal}/${result.total}`,
          `Still waiting for AI preview: ${result.remaining}`,
          ...(result.remaining
            ? ["Run the same command again to process the next unpreviewed items."]
            : [`All items are ready. Use \`/review export batch_id:${result.batchId}\`.`])
        ].join("\n")
      });
      return;
    }
    if (subcommand === "export") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const batch = deps.batchReviews.exportBatch(
        interaction.options.getString("batch_id", true)
      );
      await interaction.editReply({
        content: [
          `Review batch: \`${batch.batchId}\``,
          `UTC range: ${batch.startDate} → ${batch.endDate}`,
          `Submissions: ${batch.count}`,
          `AI preview completed: ${batch.aiPrechecked}`,
          `AI preview pending: ${batch.aiPending}`,
          "",
          "Open the `Human Review` sheet and complete the first four review fields after the IDs: `review_decision`, either `final_points` or `quality_coefficient`, and `review_note`.",
          "AI columns are suggestions only and never award points automatically.",
          "Save the workbook, then upload it with `/review import`.",
          "Allowed decisions: `approve`, `revision`, `reject`."
        ].join("\n"),
        files: [
          new AttachmentBuilder(batch.xlsx, {
            name: `review-${batch.startDate}-to-${batch.endDate}.xlsx`
          })
        ]
      });
      return;
    }
    if (subcommand === "import") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const attachment = interaction.options.getAttachment("file", true);
      if (attachment.size > 5 * 1024 * 1024) {
        throw new AppError(
          "Review file too large",
          "REVIEW_FILE_TOO_LARGE",
          "The review file must be 5 MB or smaller."
        );
      }
      console.log(`[review import] Downloading: ${attachment.name} (${attachment.size} bytes)`);
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new AppError(
          "Review file download failed",
          "REVIEW_FILE_DOWNLOAD_FAILED",
          "The review file could not be downloaded from Discord."
        );
      }
      console.log(`[review import] Parsing file: ${attachment.name} (${attachment.size} bytes)`);
      const parsed = deps.batchReviews.parse(
        Buffer.from(await response.arrayBuffer()),
        attachment.name
      );
      console.log(`[review import] Parsed: batch=${parsed.batchId}, reviews=${parsed.reviews.length}, blank=${parsed.skippedBlank}`);
      const result = deps.batchReviews.apply(parsed, interaction.user.id);
      console.log(`[review import] Applied: approved=${result.approved}, revision=${result.revisionRequired}, rejected=${result.rejected}, skipped=${result.skippedFinalized}, failed=${result.failed.length}`);
      const lines = [
        `Batch review completed: \`${result.batchId}\``,
        `Approved: ${result.approved}`,
        `Revision required: ${result.revisionRequired}`,
        `Rejected: ${result.rejected}`,
        `Points awarded: ${result.awardedPoints}`,
        `Blank decisions skipped: ${result.skippedBlank}`,
        `Already finalized rows skipped: ${result.skippedFinalized}`
      ];
      if (result.failed.length > 0) {
        lines.push(`**Failed (${result.failed.length}):**`);
        for (const f of result.failed) {
          lines.push(`  Row ${f.rowNumber} \`${f.submissionId}\`: ${f.error}`);
        }
        lines.push("Fix the CSV and re-import — already-processed rows will be skipped.");
      }
      await interaction.editReply({
        content: lines.join("\n")
      });
      // Fire-and-forget: send DM notifications without blocking the REST queue
      for (const submission of result.reviewed) {
        notifySubmissionOwner(interaction.client, submission).catch(() => {});
      }
      return;
    }
    if (subcommand === "approve-batch") {
      if (!interaction.options.getBoolean("confirm", true)) {
        throw new AppError(
          "Batch approval not confirmed",
          "BATCH_APPROVAL_NOT_CONFIRMED",
          "Set confirm to True to approve the batch and award points."
        );
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const batchId = interaction.options.getString("batch_id", true);
      const taskId = interaction.options
        .getString("task_id")
        ?.trim()
        .toUpperCase();
      const result = deps.batchReviews.approveBatch(
        batchId,
        interaction.user.id,
        {
          taskId,
          pointMode: interaction.options.getString("point_mode", true) as
            | "standard"
            | "ai_suggested",
          qualityCoefficient:
            interaction.options.getNumber("coefficient") ?? undefined,
          note: interaction.options.getString("note") ?? undefined
        }
      );
      const lines = [
          `Batch approved: \`${result.batchId}\``,
          ...(result.taskId ? [`Task filter: ${result.taskId}`] : []),
          `Approved: ${result.approved}`,
          `Points awarded: ${result.awardedPoints}`,
          `Already finalized rows skipped: ${result.skippedFinalized}`
        ];
        if (result.failed.length > 0) {
          lines.push(`**Failed (${result.failed.length}):**`);
          for (const f of result.failed) {
            lines.push(`  \`${f.submissionId}\`: ${f.error}`);
          }
        }
        await interaction.editReply({
          content: lines.join("\n")
        });
      // Fire-and-forget: send DM notifications without blocking the REST queue
      for (const submission of result.reviewed) {
        notifySubmissionOwner(interaction.client, submission).catch(() => {});
      }
      return;
    }
    if (subcommand === "next") {
      const next = new SubmissionRepository().listForReview(1)[0];
      if (!next) {
        await interaction.reply({
          content: "There are no submissions waiting for review.",
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          embeds: [reviewEmbed(next)],
          components: [reviewButtons(next.id)],
          flags: MessageFlags.Ephemeral
        });
      }
      return;
    }

    const submission = deps.submissions.review({
      submissionId: interaction.options.getString("submission_id", true),
      reviewerId: interaction.user.id,
      decision: interaction.options.getString("decision", true),
      note: interaction.options.getString("note", true),
      qualityCoefficient:
        interaction.options.getNumber("coefficient") ?? undefined
    });
    await interaction.reply({
      content: `Review completed: ${submission.id} → ${submission.status}${
        submission.finalPoints != null
          ? `, awarded ${submission.finalPoints} pts`
          : ""
      }`,
      flags: MessageFlags.Ephemeral
    });
    await notifySubmissionOwner(interaction.client, submission);
    return;
  }

  if (interaction.commandName === "activity-admin") {
    if (!canReview(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to manage activity reviews."
      );
    }
    const subcommand = interaction.options.getSubcommand();
    const activityDate = interaction.options.getString("date", true);
    if (subcommand === "status") {
      const status = deps.activity.status(seasonId, activityDate);
      await interaction.reply({
        content: [
          `Daily activity status for ${activityDate} UTC`,
          `Collected messages: ${status.messages}`,
          `Members: ${status.users}`,
          `Prepared review submissions: ${status.reviews}`
        ].join("\n"),
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (subcommand === "precheck") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await deps.activity.prepareDailyReview(seasonId, activityDate);
      await interaction.editReply({
        content: [
          `Daily activity precheck completed for ${activityDate} UTC.`,
          `Messages analyzed: ${result.messages}`,
          `Members analyzed: ${result.users}`,
          `Review submissions created: ${result.submissionsCreated}`,
          `Skipped because of weekly limits: ${result.skippedWeeklyLimit}`,
          "Use `/review export start_date:` with this date to download the review sheet."
        ].join("\n")
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel("channel", true) as any;
    if (!deps.activity.isAllowedChannel(seasonId, channel.id)) {
      throw new AppError(
        "Channel not configured",
        "ACTIVITY_CHANNEL_NOT_ALLOWED",
        "Add this channel ID to ACTIVITY_CHANNEL_IDS or the T001 allowed_channel_ids field first."
      );
    }
    if (!channel.messages?.fetch) {
      throw new AppError(
        "Unsupported channel",
        "UNSUPPORTED_ACTIVITY_CHANNEL",
        "Select a Discord text or announcement channel with message history."
      );
    }
    const start = new Date(`${activityDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${activityDate}T00:00:00.000Z`).getTime() + 86_400_000;
    // status validates the UTC date before history collection starts.
    deps.activity.status(seasonId, activityDate);
    let before: string | undefined;
    let scanned = 0;
    let collected = 0;
    let reachedStart = false;
    for (let page = 0; page < 100 && !reachedStart; page += 1) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!messages.size) break;
      scanned += messages.size;
      for (const message of messages.values() as Iterable<any>) {
        if (message.createdTimestamp < start) {
          reachedStart = true;
          continue;
        }
        if (message.createdTimestamp >= end || message.author?.bot) continue;
        if (deps.activity.recordMessage(seasonId, {
          messageId: message.id,
          userId: message.author.id,
          channelId: message.channelId,
          content: message.content,
          createdAtUtc: message.createdAt.toISOString(),
          replyToMessageId: message.reference?.messageId ?? undefined
        })) collected += 1;
      }
      before = messages.last()?.id;
      if (!before || messages.size < 100) break;
    }
    await interaction.editReply({
      content: [
        `History collection completed for ${activityDate} UTC in ${channel}.`,
        `Messages scanned: ${scanned}`,
        `New messages stored: ${collected}`,
        "Run `/activity-admin precheck` for the same UTC date next."
      ].join("\n")
    });
    return;
  }

  if (interaction.commandName === "task-admin") {
    if (!canManageTasks(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to manage tasks."
      );
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "import") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const attachment = interaction.options.getAttachment("file", true);
      if (attachment.size > 5 * 1024 * 1024) {
        throw new AppError(
          "Task file too large",
          "TASK_FILE_TOO_LARGE",
          "The task file must be 5 MB or smaller."
        );
      }
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new AppError(
          "Task file download failed",
          "TASK_FILE_DOWNLOAD_FAILED",
          "The task file could not be downloaded from Discord."
        );
      }
      const imported = deps.taskImports.parse(
        Buffer.from(await response.arrayBuffer()),
        attachment.name,
        seasonId
      );
      const result = deps.taskImports.apply(
        imported,
        seasonId,
        interaction.user.id
      );
      const draftIds = [...result.created, ...result.updated].filter(
        (id) => deps.tasks.get(id, seasonId).status === "Draft"
      );
      await interaction.editReply({
        content: [
          "Task import completed.",
          `Created: ${result.created.length}${
            result.created.length ? ` (${result.created.join(", ")})` : ""
          }`,
          `Updated: ${result.updated.length}${
            result.updated.length ? ` (${result.updated.join(", ")})` : ""
          }`,
          ...(draftIds.length
            ? [
                `Draft tasks are visible to managers only: ${draftIds.join(", ")}`,
                `Publish one with \`/task-admin status task_id:${draftIds[0]} status:Published\`.`
              ]
            : [])
        ].join("\n")
      });
      return;
    }

    const taskId = interaction.options.getString("task_id", true).toUpperCase();
    if (subcommand === "edit") {
      const title = interaction.options.getString("title") ?? undefined;
      const type =
        (interaction.options.getString("type") as TaskType | null) ?? undefined;
      const difficulty =
        (interaction.options.getString(
          "difficulty"
        ) as TaskDifficulty | null) ?? undefined;
      const points = interaction.options.getInteger("points") ?? undefined;
      const minPoints = interaction.options.getInteger("min_points");
      const maxPoints = interaction.options.getInteger("max_points");
      const description =
        interaction.options.getString("description") ?? undefined;
      const requirementsText =
        interaction.options.getString("requirements") ?? undefined;
      const requirements = requirementsText
        ?.split("|")
        .map((item: string) => item.trim())
        .filter(Boolean);
      const perDay = interaction.options.getInteger("per_day");
      const perWeek = interaction.options.getInteger("per_week");
      const perMonth = interaction.options.getInteger("per_month");
      const perSeason = interaction.options.getInteger("per_season");
      const reviewMode =
        (interaction.options.getString("review_mode") as ReviewMode | null) ??
        undefined;
      const claimRequired =
        interaction.options.getBoolean("claim_required") ?? undefined;
      const aiPrecheck = interaction.options.getBoolean("ai_precheck");
      if (
        !title &&
        !type &&
        !difficulty &&
        points == null &&
        minPoints == null &&
        maxPoints == null &&
        !description &&
        !requirementsText &&
        perDay == null &&
        perWeek == null &&
        perMonth == null &&
        perSeason == null &&
        !reviewMode &&
        claimRequired == null &&
        aiPrecheck == null
      ) {
        throw new AppError(
          "No changes",
          "NO_CHANGES",
          "Provide at least one field to update."
        );
      }
      if (
        [title, description, ...(requirements ?? [])].some(
          (value) => value && /[\u3400-\u9fff]/u.test(value)
        )
      ) {
        throw new AppError(
          "User-facing task text must be English",
          "TASK_TEXT_NOT_ENGLISH",
          "Task titles, descriptions, and requirements must be written in English."
        );
      }
      const current = deps.tasks.get(taskId, seasonId);
      const pluginIds = new Set(current.config.pluginIds);
      if (aiPrecheck === true) pluginIds.add("ai_webhook_precheck");
      if (aiPrecheck === false) pluginIds.delete("ai_webhook_precheck");
      const updated = deps.tasks.update(
        taskId,
        seasonId,
        {
          ...(title ? { title } : {}),
          ...(type ? { type } : {}),
          ...(difficulty ? { difficulty } : {}),
          ...(points != null ? { basePoints: points } : {}),
          ...(minPoints != null
            ? { minPoints: minPoints === 0 ? undefined : minPoints }
            : {}),
          ...(maxPoints != null
            ? { maxPoints: maxPoints === 0 ? undefined : maxPoints }
            : {}),
          ...(description ? { description } : {}),
          ...(requirements ? { requirements } : {}),
          ...(reviewMode ? { reviewMode } : {}),
          ...(claimRequired != null ? { claimRequired } : {}),
          ...(perDay != null ||
          perWeek != null ||
          perMonth != null ||
          perSeason != null
            ? {
                limits: {
                  ...current.config.limits,
                  ...(perDay != null
                    ? { perDay: perDay === 0 ? undefined : perDay }
                    : {}),
                  ...(perWeek != null
                    ? { perWeek: perWeek === 0 ? undefined : perWeek }
                    : {}),
                  ...(perMonth != null
                    ? { perMonth: perMonth === 0 ? undefined : perMonth }
                    : {}),
                  ...(perSeason != null
                    ? {
                        perSeason: perSeason === 0 ? undefined : perSeason
                      }
                    : {})
                }
              }
            : {}),
          ...(aiPrecheck != null ? { pluginIds: [...pluginIds] } : {})
        },
        interaction.user.id
      );
      await interaction.reply({
        content: `Task updated: ${updated.id} v${updated.currentVersion}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (subcommand === "delete") {
      const archived = deps.tasks.setStatus(
        taskId,
        seasonId,
        "Archived",
        interaction.user.id
      );
      await interaction.reply({
        content: `Task archived: ${archived.id}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (subcommand === "clone") {
      const newTaskId = interaction.options
        .getString("new_task_id", true)
        .toUpperCase();
      const cloned = deps.tasks.clone(
        taskId,
        seasonId,
        newTaskId,
        seasonId,
        interaction.user.id
      );
      await interaction.reply({
        content: `Task cloned as draft: ${cloned.id}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const status = interaction.options.getString("status", true) as TaskStatus;
    const updated = deps.tasks.setStatus(
      taskId,
      seasonId,
      status,
      interaction.user.id
    );
    await interaction.reply({
      content: `Task status updated: ${updated.id} → ${updated.status}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "export") {
    if (!canManageTasks(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to export data."
      );
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const type = interaction.options.getString("type", true) as ExportType;
    const csv = deps.exports.export(seasonId, type);
    await interaction.editReply({
      content: `Season 2 ${type} export`,
      files: [
        new AttachmentBuilder(Buffer.from(csv, "utf8"), {
          name: `season2-${type}.csv`
        })
      ]
    });
  }
}

async function handleButton(interaction: any, deps: Dependencies): Promise<void> {
  const [action, ...parts] = interaction.customId.split(":");
  const seasonId = config.defaultSeasonId;

  if (action === "claim") {
    const message = deps.tasks.claim(parts[0], seasonId, interaction.user.id);
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (action === "submit") {
    const taskId = parts[0];
    const modal = new ModalBuilder()
      .setCustomId(`submit_modal:${taskId}`)
      .setTitle(`Submit task ${taskId}`);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("summary")
          .setLabel("Process, result, and personal summary")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(20)
          .setMaxLength(2000)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("proof_url")
          .setLabel("Public link, demo, or evidence URL")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
    await interaction.showModal(modal);
    return;
  }
  if (action === "my_progress") {
    const profile = deps.points.profile(seasonId, interaction.user.id);
    await interaction.reply({
      content: `Lv.${profile.level} ${profile.title} · ${profile.total} pts`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (action === "review") {
    if (!canReview(interaction)) {
      throw new AppError(
        "Forbidden",
        "FORBIDDEN",
        "You do not have permission to review submissions."
      );
    }
    const [decision, coefficient, submissionId] = parts;
    const submission = deps.submissions.review({
      submissionId,
      reviewerId: interaction.user.id,
      decision,
      note:
        decision === "approve"
          ? "Approved with a quick review action"
          : decision === "revision"
            ? "Please add evidence based on the acceptance criteria"
            : "The submission did not meet the acceptance criteria",
      qualityCoefficient: Number(coefficient)
    });
    await interaction.update({
      content: `Review completed: ${submission.status}${
        submission.finalPoints != null ? ` · ${submission.finalPoints} pts` : ""
      }`,
      embeds: [],
      components: []
    });
    // Fire-and-forget: don't block the REST queue with DM notifications
    notifySubmissionOwner(interaction.client, submission).catch(() => {});
  }
}

async function handleModal(interaction: any, deps: Dependencies): Promise<void> {
  const [action, taskId] = interaction.customId.split(":");
  if (action !== "submit_modal") return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const submission = await deps.submissions.submit(
    {
      taskId,
      userId: interaction.user.id,
      summary: interaction.fields.getTextInputValue("summary"),
      proofUrl:
        interaction.fields.getTextInputValue("proof_url").trim() || undefined
    },
    config.defaultSeasonId
  );
  await interaction.editReply(
    `Submission received: \`${submission.id}\`\nStatus: ${submission.status}`
  );
}

async function notifySubmissionOwner(
  client: Client,
  submission: {
    userId: string;
    id: string;
    status: string;
    finalPoints?: number;
    reviewNote?: string;
  }
): Promise<void> {
  try {
    const user = await client.users.fetch(submission.userId);
    await user.send(
      `Your task submission \`${submission.id}\` is now **${submission.status}**${
        submission.finalPoints != null
          ? ` and earned ${submission.finalPoints} pts`
          : ""
      }${submission.reviewNote ? `\nReview note: ${submission.reviewNote}` : ""}`
    );
  } catch {
    // Closed DMs do not affect the review result.
  }
}
