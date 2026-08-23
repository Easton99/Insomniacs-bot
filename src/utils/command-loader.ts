import { readdirSync } from 'fs';
import { join } from 'path';
import { Collection } from 'discord.js';
import { BotCommand } from '../types';
import logger from './logger';

export function loadCommands(): Collection<string, BotCommand> {
  const commands = new Collection<string, BotCommand>();
  const commandsDir = join(__dirname, '..', 'commands');

  const files = readdirSync(commandsDir).filter(
    (f) => f.endsWith('.js') || f.endsWith('.ts'),
  );

  for (const file of files) {
    const filePath = join(commandsDir, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath) as Partial<BotCommand>;

    if ('data' in mod && 'execute' in mod && mod.data && mod.execute) {
      commands.set(mod.data.name, mod as BotCommand);
      logger.debug(`Loaded command: ${mod.data.name}`);
    } else {
      logger.warn({ file }, 'Skipping invalid command file — missing data or execute export');
    }
  }

  logger.info(`Loaded ${commands.size} command(s)`);
  return commands;
}

