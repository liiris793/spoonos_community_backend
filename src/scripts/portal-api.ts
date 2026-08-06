import { Client, GatewayIntentBits } from "discord.js";
import { seed } from "./seed.js";
import { TaskService } from "../services/task-service.js";
import { PointsService } from "../services/points-service.js";
import { startPublicApi } from "../http/public-api.js";

seed();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const server = startPublicApi({
  client,
  tasks: new TaskService(),
  points: new PointsService()
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(
  "Portal-only mode is ready. Discord names and avatars use safe fallbacks until the full Bot is connected."
);
