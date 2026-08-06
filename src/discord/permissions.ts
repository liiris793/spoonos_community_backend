import type { GuildMember, Interaction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { config } from "../config.js";

const memberRoleIds = (interaction: Interaction): string[] => {
  if (!interaction.inGuild()) return [];
  const member = interaction.member as GuildMember;
  return [...member.roles.cache.keys()];
};

const hasConfiguredRole = (
  interaction: Interaction,
  roleIds: string[]
): boolean => memberRoleIds(interaction).some((id) => roleIds.includes(id));

export const canReview = (interaction: Interaction): boolean => {
  if (!interaction.inGuild()) return false;
  const member = interaction.member as GuildMember;
  return (
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    hasConfiguredRole(interaction, config.reviewerRoleIds) ||
    hasConfiguredRole(interaction, config.adminRoleIds)
  );
};

export const canManageTasks = (interaction: Interaction): boolean => {
  if (!interaction.inGuild()) return false;
  const member = interaction.member as GuildMember;
  return (
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    hasConfiguredRole(interaction, config.taskManagerRoleIds) ||
    hasConfiguredRole(interaction, config.adminRoleIds)
  );
};
