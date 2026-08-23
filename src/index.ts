import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import logger from './utils/logger';
import { connectDatabase, disconnectDatabase } from './database/client';
import { loadCommands } from './utils/command-loader';
import { handleInteraction } from './utils/interaction-handler';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function main(): Promise<void> {
  logger.info('Starting Insomniacs Bot…');

  try {
    await connectDatabase();
  } catch (dbError: unknown) {
    logger.warn({ dbError }, 'Database unavailable — bot will start without DB (commands requiring storage will fail)');
  }

  const commands = loadCommands();

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, 'Bot online');
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction, commands).catch((error: unknown) => {
      logger.error({ error }, 'Unhandled error in interaction handler');
    });
  });

  await client.login(config.DISCORD_TOKEN);
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down…');
  void client.destroy();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown().catch((error: unknown) => logger.error({ error }, 'Error during shutdown'));
});
process.on('SIGTERM', () => {
  void shutdown().catch((error: unknown) => logger.error({ error }, 'Error during shutdown'));
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception — exiting');
  process.exit(1);
});

main().catch((error: unknown) => {
  logger.error({ error }, 'Fatal startup error');
  process.exit(1);
});
