import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { commands } from "./commands.js";
import { ProxyAgent } from "undici";

if (!config.discordToken || !config.discordClientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required.");
}

const rest = new REST({ version: "10", timeout: 45_000, retries: 5 }).setToken(
  config.discordToken
);
if (config.discordProxyUrl) {
  rest.setAgent(new ProxyAgent(config.discordProxyUrl));
}

if (config.discordGuildId) {
  const globalCommands = (await rest.get(
    Routes.applicationCommands(config.discordClientId)
  )) as { id: string }[];
  if (globalCommands.length) {
    await rest.put(Routes.applicationCommands(config.discordClientId), {
      body: []
    });
    console.log(`Removed ${globalCommands.length} legacy global commands.`);
  }
  await rest.put(
    Routes.applicationGuildCommands(
      config.discordClientId,
      config.discordGuildId
    ),
    { body: commands }
  );
  console.log(`Registered ${commands.length} guild commands.`);
} else {
  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: commands
  });
  console.log(`Registered ${commands.length} global commands.`);
}
