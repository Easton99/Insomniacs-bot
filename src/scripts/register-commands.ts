import { REST, Routes } from 'discord.js';
import { config } from '../config';
import logger from '../utils/logger';
import { loadCommands } from '../utils/command-loader';

async function registerCommands(): Promise<void> {
  const { commands, standaloneCommands, parentCommand } = loadCommands();

  const rest = new REST().setToken(config.DISCORD_TOKEN);
  const commandData = [parentCommand.toJSON(), ...standaloneCommands.map((c) => c.command.toJSON())];

  if (config.DISCORD_GUILD_ID) {
    logger.info(
      { subcommands: commands.size, standalone: standaloneCommands.size, guildId: config.DISCORD_GUILD_ID },
      'Registering commands to guild (instant)…',
    );
    await rest.put(
      Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
      { body: commandData },
    );
    logger.info('Guild commands registered');
  } else {
    logger.info(
      { subcommands: commands.size, standalone: standaloneCommands.size },
      'Registering commands globally (may take up to 1 hour to appear)…',
    );
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: commandData });
    logger.info('Global commands registered');
  }
}

registerCommands().catch((error: unknown) => {
  logger.error({ error }, 'Failed to register commands');
  process.exit(1);
});
