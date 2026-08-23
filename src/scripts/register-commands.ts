import { readdirSync } from 'fs';
import { join } from 'path';
import { REST, Routes } from 'discord.js';
import { config } from '../config';
import logger from '../utils/logger';

interface CommandModule {
  data?: { toJSON(): unknown };
}

async function registerCommands(): Promise<void> {
  const commandsDir = join(__dirname, '..', 'commands');
  const files = readdirSync(commandsDir).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  const commandData: unknown[] = [];

  for (const file of files) {
    const filePath = join(commandsDir, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath) as CommandModule;
    if (mod.data) {
      commandData.push(mod.data.toJSON());
      logger.info(`Queued command: ${file}`);
    }
  }

  const rest = new REST().setToken(config.DISCORD_TOKEN);

  if (config.DISCORD_GUILD_ID) {
    // Guild registration: instant, scoped to one server — good for dev/testing
    logger.info(
      { count: commandData.length, guildId: config.DISCORD_GUILD_ID },
      'Registering commands to guild (instant)…',
    );
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
      { body: commandData },
    );
    logger.info('Guild commands registered');
  } else {
    // Global registration: works in every server, propagates within ~1 hour
    logger.info(
      { count: commandData.length },
      'Registering commands globally (may take up to 1 hour to appear)…',
    );
    await rest.put(
      Routes.applicationCommands(config.DISCORD_CLIENT_ID),
      { body: commandData },
    );
    logger.info('Global commands registered');
  }
}

registerCommands().catch((error: unknown) => {
  logger.error({ error }, 'Failed to register commands');
  process.exit(1);
});
