import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { config } from '../config';
import logger from '../utils/logger';

async function clearGuildCommands(): Promise<void> {
  const rest = new REST().setToken(config.DISCORD_TOKEN);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await client.login(config.DISCORD_TOKEN);
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));

  const guilds = client.guilds.cache;
  logger.info({ count: guilds.size }, 'Clearing guild-specific commands from all guilds');

  const results = await Promise.allSettled(
    guilds.map((guild) =>
      rest
        .put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guild.id), { body: [] })
        .then(() => logger.info({ guildId: guild.id, name: guild.name }, 'Cleared guild commands')),
    ),
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    logger.warn({ failed: failed.length }, 'Some guilds failed to clear');
  }

  logger.info('Done — global commands will now apply to all guilds');
  client.destroy();
}

clearGuildCommands().catch((error: unknown) => {
  logger.error({ error }, 'Failed to clear guild commands');
  process.exit(1);
});
