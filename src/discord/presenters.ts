import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";
import type { SubmissionRecord, TaskRecord } from "../core/types.js";

const difficultyColor: Record<string, number> = {
  Quick: 0x7dd3fc,
  Standard: 0x3b82f6,
  Advanced: 0x7c3aed,
  Bounty: 0xf59e0b
};

export const ANNOUNCEMENT_COLOR = 0x7c3aed;

export function parseAnnouncementMarkdown(content: string): {
  summary: string;
  sections: Array<{ name: string; value: string }>;
} {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const summary: string[] = [];
  const sections: Array<{ name: string; value: string }> = [];
  let currentName: string | undefined;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentName) return;
    const value = currentBody.join("\n").trim() || "\u200b";
    sections.push({
      name: currentName.slice(0, 256),
      value: value.slice(0, 1024)
    });
    currentBody = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)\s*$/);
    if (heading) {
      flush();
      currentName = heading[1].trim();
    } else if (currentName) {
      currentBody.push(line);
    } else {
      summary.push(line);
    }
  }
  flush();

  return {
    summary: summary.join("\n").trim(),
    sections: sections.slice(0, 25)
  };
}

export function announcementEmbed(input: {
  title: string;
  content: string;
  link?: string;
  imageUrl?: string;
}): EmbedBuilder {
  const parsed = parseAnnouncementMarkdown(input.content);
  const embed = new EmbedBuilder()
    .setColor(ANNOUNCEMENT_COLOR)
    .setAuthor({ name: "SpoonOS Community Update" })
    .setTitle(input.title)
    .setDescription(
      (parsed.summary || (parsed.sections.length ? "\u200b" : input.content)).slice(
        0,
        4096
      )
    )
    .setFooter({ text: "SpoonOS Team" })
    .setTimestamp();

  if (parsed.sections.length) embed.addFields(parsed.sections);
  if (input.link) embed.setURL(input.link);
  if (input.imageUrl) embed.setImage(input.imageUrl);
  return embed;
}

export function taskEmbed(task: TaskRecord): EmbedBuilder {
  const config = task.config;
  const limits = [
    config.limits.perDay ? `${config.limits.perDay} per day` : "",
    config.limits.perWeek ? `${config.limits.perWeek} per week` : "",
    config.limits.perMonth ? `${config.limits.perMonth} per month` : "",
    config.limits.perSeason ? `${config.limits.perSeason} per season` : ""
  ].filter(Boolean);

  return new EmbedBuilder()
    .setColor(difficultyColor[config.difficulty] ?? 0x3b82f6)
    .setTitle(`[${task.id}] ${config.titleEn ?? config.title} · ${config.basePoints} pts`)
    .setDescription(
      config.descriptionEn ??
        config.description ??
        "See the program rules for task details."
    )
    .addFields(
      {
        name: "Type & difficulty",
        value: `${config.type} · ${config.difficulty}`,
        inline: true
      },
      {
        name: "Review mode",
        value: config.reviewMode,
        inline: true
      },
      {
        name: "Limits",
        value: limits.join(" / ") || "No configured limit",
        inline: true
      },
      {
        name: "Acceptance criteria",
        value:
          config.requirements.map((item) => `• ${item}`).join("\n") ||
          "See the task announcement"
      }
    )
    .setFooter({
      text: `Version ${task.currentVersion} · ${task.status}`
    });
}

export function taskButtons(task: TaskRecord) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim:${task.id}`)
      .setLabel(task.config.claimRequired ? "Claim task" : "No claim needed")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!task.config.claimRequired),
    new ButtonBuilder()
      .setCustomId(`submit:${task.id}`)
      .setLabel("Submit evidence")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("my_progress")
      .setLabel("My progress")
      .setStyle(ButtonStyle.Secondary)
  );
}

export function reviewEmbed(submission: SubmissionRecord): EmbedBuilder {
  const ai = submission.aiPrecheck;
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`Pending review | ${submission.taskId}`)
    .setDescription(submission.summary.slice(0, 3500))
    .addFields(
      { name: "Submission ID", value: submission.id },
      { name: "User", value: `<@${submission.userId}>`, inline: true },
      { name: "Status", value: submission.status, inline: true },
      {
        name: "Evidence",
        value:
          [submission.proofUrl, submission.attachmentUrl]
            .filter(Boolean)
            .join("\n") || "Not provided"
      },
      {
        name: "Precheck",
        value: ai
          ? `Score: ${ai.score}\nRecommendation: ${ai.recommendation}\nFlags: ${
              ai.flags.join(", ") || "None"
            }\nMissing: ${ai.missingItems.join("; ") || "None"}`
          : "Not enabled"
      }
    )
    .setTimestamp(new Date(submission.createdAt));
}

export function reviewButtons(submissionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`review:approve:1:${submissionId}`)
      .setLabel("Approve 1.0")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`review:approve:1.25:${submissionId}`)
      .setLabel("Excellent 1.25")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`review:revision:1:${submissionId}`)
      .setLabel("Request revision")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`review:reject:1:${submissionId}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
  );
}
