import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_PROXY_URL: z.string().url().optional().or(z.literal("")),
  DATABASE_PATH: z.string().default("./data/community.db"),
  ADMIN_ROLE_IDS: z.string().default(""),
  REVIEWER_ROLE_IDS: z.string().default(""),
  TASK_MANAGER_ROLE_IDS: z.string().default(""),
  AI_PRECHECK_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  AI_PRECHECK_WEBHOOK_TOKEN: z.string().optional(),
  PRECHECK_SERVICE_URL: z.string().url().optional().or(z.literal("")),
  PRECHECK_SERVICE_TOKEN: z.string().optional(),
  ACTIVITY_CHANNEL_IDS: z.string().default(""),
  DEFAULT_SEASON_ID: z.string().default("season-2"),
  PUBLIC_API_ENABLED: z.enum(["true", "false"]).default("false"),
  PUBLIC_API_PORT: z.coerce.number().int().positive().default(8787),
  PORT: z.coerce.number().int().positive().optional(),
  PUBLIC_API_HOST: z.string().default("0.0.0.0"),
  PORTAL_CORS_ORIGIN: z.string().default("*"),
  COMMUNITY_PORTAL_URL: z.string().url().optional().or(z.literal(""))
});

const parsed = envSchema.parse(process.env);

const splitIds = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const config = {
  discordToken: parsed.DISCORD_TOKEN,
  discordClientId: parsed.DISCORD_CLIENT_ID,
  discordGuildId: parsed.DISCORD_GUILD_ID,
  discordProxyUrl: parsed.DISCORD_PROXY_URL || undefined,
  databasePath: parsed.DATABASE_PATH,
  adminRoleIds: splitIds(parsed.ADMIN_ROLE_IDS),
  reviewerRoleIds: splitIds(parsed.REVIEWER_ROLE_IDS),
  taskManagerRoleIds: splitIds(parsed.TASK_MANAGER_ROLE_IDS),
  aiPrecheckWebhookUrl: parsed.AI_PRECHECK_WEBHOOK_URL || undefined,
  aiPrecheckWebhookToken: parsed.AI_PRECHECK_WEBHOOK_TOKEN,
  precheckServiceUrl: parsed.PRECHECK_SERVICE_URL || undefined,
  precheckServiceToken: parsed.PRECHECK_SERVICE_TOKEN,
  activityChannelIds: splitIds(parsed.ACTIVITY_CHANNEL_IDS),
  defaultSeasonId: parsed.DEFAULT_SEASON_ID,
  publicApiEnabled: parsed.PUBLIC_API_ENABLED === "true",
  publicApiPort: parsed.PORT ?? parsed.PUBLIC_API_PORT,
  publicApiHost: parsed.PUBLIC_API_HOST,
  portalCorsOrigin: parsed.PORTAL_CORS_ORIGIN,
  communityPortalUrl: parsed.COMMUNITY_PORTAL_URL || undefined
};
