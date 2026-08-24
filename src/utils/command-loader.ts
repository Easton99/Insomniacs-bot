import { readdirSync } from 'fs';
import { join } from 'path';
import { Collection, SlashCommandBuilder } from 'discord.js';
import { SubCommand, StandaloneCommand } from '../types';
import logger from './logger';

const PARENT_NAME = 'ic';
const PARENT_DESCRIPTION = 'Insomniacs Bot — CS2 & FACEIT statistics';

export function loadCommands(): {
  commands: Collection<string, SubCommand>;
  standaloneCommands: Collection<string, StandaloneCommand>;
  parentCommand: SlashCommandBuilder;
} {
  const commands = new Collection<string, SubCommand>();
  const standaloneCommands = new Collection<string, StandaloneCommand>();
  const commandsDir = join(__dirname, '..', 'commands');

  const files = readdirSync(commandsDir).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    const filePath = join(commandsDir, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath) as Partial<SubCommand & StandaloneCommand>;

    if (mod.command && typeof mod.execute === 'function') {
      standaloneCommands.set(mod.command.name, { command: mod.command, execute: mod.execute });
      logger.debug(`Loaded standalone command: /${mod.command.name}`);
    } else if (mod.subcommand && typeof mod.execute === 'function') {
      commands.set(mod.subcommand.name, { subcommand: mod.subcommand, execute: mod.execute });
      logger.debug(`Loaded subcommand: ic ${mod.subcommand.name}`);
    } else {
      logger.warn({ file }, 'Skipping invalid command file — missing subcommand/command or execute export');
    }
  }

  const parentCommand = new SlashCommandBuilder()
    .setName(PARENT_NAME)
    .setDescription(PARENT_DESCRIPTION);

  for (const cmd of commands.values()) {
    parentCommand.addSubcommand(cmd.subcommand);
  }

  logger.info(`Loaded ${commands.size} subcommand(s) under /${PARENT_NAME}, ${standaloneCommands.size} standalone command(s)`);
  return { commands, standaloneCommands, parentCommand };
}
