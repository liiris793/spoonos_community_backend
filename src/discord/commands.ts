import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("season")
    .setDescription("View the current community contribution season"),
  new SlashCommandBuilder()
    .setName("tasks")
    .setDescription("Browse the community task center")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Filter by task type")
        .addChoices(
          { name: "Daily", value: "Daily" },
          { name: "Social", value: "Social" },
          { name: "Community", value: "Community" },
          { name: "Contribute", value: "Contribute" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("difficulty")
        .setDescription("Filter by task difficulty")
        .addChoices(
          { name: "Quick", value: "Quick" },
          { name: "Standard", value: "Standard" },
          { name: "Advanced", value: "Advanced" },
          { name: "Bounty", value: "Bounty" }
        )
    ),
  new SlashCommandBuilder()
    .setName("task")
    .setDescription("View task details")
    .addStringOption((option) =>
      option.setName("task_id").setDescription("Task ID, for example T018").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("submit")
    .setDescription("Submit task evidence")
    .addStringOption((option) =>
      option.setName("task_id").setDescription("Task ID").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("summary")
        .setDescription("Completion process, result, and personal summary")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("proof_url").setDescription("Public link, demo, or evidence URL")
    )
    .addAttachmentOption((option) =>
      option.setName("attachment").setDescription("Screenshot or supporting attachment")
    ),
  new SlashCommandBuilder()
    .setName("me")
    .setDescription("View my points, level, and recent tasks"),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the season leaderboard"),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Publish a community update embed as the bot")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Announcement title")
        .setRequired(true)
        .setMaxLength(256)
    )
    .addStringOption((option) =>
      option
        .setName("content")
        .setDescription("Short announcement body with Discord Markdown")
        .setMaxLength(4000)
    )
    .addAttachmentOption((option) =>
      option
        .setName("content_file")
        .setDescription("Optional .md or .txt file with ## section headings")
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Target channel; defaults to the current channel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((option) =>
      option
        .setName("link")
        .setDescription("Optional link opened from the embed title")
        .setMaxLength(1000)
    )
    .addAttachmentOption((option) =>
      option.setName("image").setDescription("Optional announcement image")
    )
    .addBooleanOption((option) =>
      option
        .setName("mention_everyone")
        .setDescription("Also mention @everyone; disabled by default")
    ),
  new SlashCommandBuilder()
    .setName("points-admin")
    .setDescription("Add or deduct user points")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName("user").setDescription("Target user").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Positive to add points; negative to deduct")
        .setRequired(true)
        .setMinValue(-10000)
        .setMaxValue(10000)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for the adjustment").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("task_id").setDescription("Related task ID")
    ),
  new SlashCommandBuilder()
    .setName("review")
    .setDescription("Review task submissions")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) => sub.setName("next").setDescription("View the next pending submission"))
    .addSubcommand((sub) =>
      sub
        .setName("create-batch")
        .setDescription("Create a fixed batch from unreviewed submissions")
        .addIntegerOption((option) =>
          option
            .setName("days")
            .setDescription("Previous completed UTC days; omit for all pending")
            .setMinValue(1)
            .setMaxValue(90)
        )
        .addStringOption((option) =>
          option
            .setName("start_date")
            .setDescription("Optional UTC start date in YYYY-MM-DD")
        )
        .addStringOption((option) =>
          option
            .setName("end_date")
            .setDescription("Optional UTC end date in YYYY-MM-DD")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List all review batches")
    )
    .addSubcommand((sub) =>
      sub
        .setName("ai-preview")
        .setDescription("AI-preview the next unprocessed items in a batch")
        .addStringOption((option) =>
          option
            .setName("batch_id")
            .setDescription("Review batch ID")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Next unprocessed submissions to preview (default 5)")
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("export")
        .setDescription("Export one existing batch for final human review")
        .addStringOption((option) =>
          option
            .setName("batch_id")
            .setDescription("Review batch ID")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("import")
        .setDescription("Import completed review decisions and award points")
        .addAttachmentOption((option) =>
          option
            .setName("file")
            .setDescription("Completed review file in .csv, .xlsx, or .xls format")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("approve-batch")
        .setDescription("Approve every pending submission in a review batch")
        .addStringOption((option) =>
          option
            .setName("batch_id")
            .setDescription("Review batch ID")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addBooleanOption((option) =>
          option
            .setName("confirm")
            .setDescription("Confirm this bulk point-awarding action")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("point_mode")
            .setDescription("Use standard task points or AI suggested points")
            .setRequired(true)
            .addChoices(
              { name: "Standard task points", value: "standard" },
              { name: "AI suggested points", value: "ai_suggested" }
            )
        )
        .addStringOption((option) =>
          option
            .setName("task_id")
            .setDescription("Optional Task ID filter within the batch")
        )
        .addNumberOption((option) =>
          option
            .setName("coefficient")
            .setDescription("Quality coefficient: 0.5 / 1 / 1.25 / 1.5")
            .addChoices(
              { name: "0.5", value: 0.5 },
              { name: "1.0", value: 1 },
              { name: "1.25", value: 1.25 },
              { name: "1.5", value: 1.5 }
            )
        )
        .addStringOption((option) =>
          option
            .setName("note")
            .setDescription("Review note applied to every approved submission")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("decide")
        .setDescription("Record a review decision")
        .addStringOption((option) =>
          option
            .setName("submission_id")
            .setDescription("Submission ID")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("decision")
            .setDescription("Review decision")
            .setRequired(true)
            .addChoices(
              { name: "Approve", value: "approve" },
              { name: "Request revision", value: "revision" },
              { name: "Reject", value: "reject" }
            )
        )
        .addStringOption((option) =>
          option.setName("note").setDescription("Review note").setRequired(true)
        )
        .addNumberOption((option) =>
          option
            .setName("coefficient")
            .setDescription("Approval coefficient: 0.5 / 1 / 1.25 / 1.5")
        )
    ),
  new SlashCommandBuilder()
    .setName("task-admin")
    .setDescription("Import, edit, publish, and archive tasks")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("import")
        .setDescription("Create or update tasks from a CSV or Excel file")
        .addAttachmentOption((o) =>
          o
            .setName("file")
            .setDescription("Task table in .csv, .xlsx, or .xls format")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit a task and create a new version")
        .addStringOption((o) =>
          o.setName("task_id").setDescription("Task ID").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("title").setDescription("New task title")
        )
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("New task type")
            .addChoices(
              { name: "Daily", value: "Daily" },
              { name: "Social", value: "Social" },
              { name: "Community", value: "Community" },
              { name: "Contribute", value: "Contribute" }
            )
        )
        .addStringOption((o) =>
          o
            .setName("difficulty")
            .setDescription("New task difficulty")
            .addChoices(
              { name: "Quick", value: "Quick" },
              { name: "Standard", value: "Standard" },
              { name: "Advanced", value: "Advanced" },
              { name: "Bounty", value: "Bounty" }
            )
        )
        .addIntegerOption((o) =>
          o.setName("points").setDescription("New base points")
        )
        .addIntegerOption((o) =>
          o.setName("min_points").setDescription("New minimum points")
        )
        .addIntegerOption((o) =>
          o.setName("max_points").setDescription("New maximum points")
        )
        .addStringOption((o) =>
          o.setName("description").setDescription("New task description")
        )
        .addStringOption((o) =>
          o
            .setName("requirements")
            .setDescription("Acceptance criteria separated with |")
        )
        .addIntegerOption((o) =>
          o.setName("per_day").setDescription("Daily limit; use 0 to remove")
        )
        .addIntegerOption((o) =>
          o.setName("per_week").setDescription("Weekly limit; use 0 to remove")
        )
        .addIntegerOption((o) =>
          o.setName("per_month").setDescription("Monthly limit; use 0 to remove")
        )
        .addIntegerOption((o) =>
          o.setName("per_season").setDescription("Season limit; use 0 to remove")
        )
        .addStringOption((o) =>
          o
            .setName("review_mode")
            .setDescription("Review mode")
            .addChoices(
              { name: "Human review", value: "human" },
              { name: "Rules then human", value: "rules_then_human" },
              { name: "AI then human", value: "ai_then_human" },
              { name: "Automatic", value: "auto" }
            )
        )
        .addBooleanOption((o) =>
          o.setName("claim_required").setDescription("Require users to claim first")
        )
        .addBooleanOption((o) =>
          o.setName("ai_precheck").setDescription("Enable AI webhook precheck")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Publish, pause, close, or archive a task")
        .addStringOption((o) =>
          o.setName("task_id").setDescription("Task ID").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("status")
            .setDescription("New task status")
            .setRequired(true)
            .addChoices(
              { name: "Published", value: "Published" },
              { name: "Paused", value: "Paused" },
              { name: "Closed", value: "Closed" },
              { name: "Archived", value: "Archived" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Archive a task by Task ID")
        .addStringOption((o) =>
          o.setName("task_id").setDescription("Task ID").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("clone")
        .setDescription("Clone a task as a new draft")
        .addStringOption((o) =>
          o.setName("task_id").setDescription("Source task ID").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("new_task_id").setDescription("New task ID").setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName("activity-admin")
    .setDescription("Collect and pre-review daily community activity")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName("collect")
        .setDescription("Collect a channel's messages for one completed UTC day")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Configured activity channel")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Completed UTC date in YYYY-MM-DD format")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("precheck")
        .setDescription("Run rules and AI suggestions for a collected UTC day")
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Completed UTC date in YYYY-MM-DD format")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("View collection and pre-review status for a UTC day")
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("UTC date in YYYY-MM-DD format")
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName("export")
    .setDescription("Export season data as CSV")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("Data type to export")
        .setRequired(true)
        .addChoices(
          { name: "User summary", value: "users" },
          { name: "Task performance", value: "tasks" },
          { name: "Submissions", value: "submissions" },
          { name: "Point ledger", value: "points" },
          { name: "Content assets", value: "content" }
        )
    )
].map((command) => command.toJSON());

export type CommandDefinition = (typeof commands)[number];
