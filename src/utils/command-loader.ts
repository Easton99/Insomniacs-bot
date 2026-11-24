import { readdirSync } from 'fs';
import { join } from 'path';
import { Collection, SlashCommandBuilder } from 'discord.js';
import { IcCommand, StandaloneCommand, SubCommand, SubCommandGroup, isSubCommandGroup } from '../types';
import logger from './logger';

const PARENT_NAME = 'ic';
const PARENT_DESCRIPTION = 'Insomniacs Bot — CS2 & FACEIT statistics';

/**
 * Loads every file in src/commands. A file exports one of:
 *   subcommand + execute   → /ic <name>
 *   group + execute        → /ic <group> <sub>   (subcommand group)
 *   command + execute      → standalone top-level command
 * `commands` is keyed by subcommand or group name.
 */
export function loadCommands(): {
  commands: Collection<string, IcCommand>;
  standaloneCommands: Collection<string, StandaloneCommand>;
  parentCommand: SlashCommandBuilder;
} {
  const commands = new Collection<string, IcCommand>();
  const standaloneCommands = new Collection<string, StandaloneCommand>();
  const commandsDir = join(__dirname, '..', 'commands');

  const files = readdirSync(commandsDir).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  for (const file of files) {
    const filePath = join(commandsDir, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath) as Partial<SubCommand & SubCommandGroup & StandaloneCommand>;

    if (typeof mod.execute !== 'function') {
      logger.warn({ file }, 'Skipping invalid command file — missing execute export');
    } else if (mod.command) {
      standaloneCommands.set(mod.command.name, { command: mod.command, execute: mod.execute });
      logger.debug(`Loaded standalone command: /${mod.command.name}`);
    } else if (mod.group) {
      commands.set(mod.group.name, { group: mod.group, execute: mod.execute, autocomplete: mod.autocomplete });
      logger.debug(`Loaded subcommand group: ic ${mod.group.name}`);
    } else if (mod.subcommand) {
      commands.set(mod.subcommand.name, { subcommand: mod.subcommand, execute: mod.execute, autocomplete: mod.autocomplete });
      logger.debug(`Loaded subcommand: ic ${mod.subcommand.name}`);
    } else {
      logger.warn({ file }, 'Skipping invalid command file — missing subcommand/group/command export');
    }
  }

  const parentCommand = new SlashCommandBuilder()
    .setName(PARENT_NAME)
    .setDescription(PARENT_DESCRIPTION);

  for (const cmd of commands.values()) {
    if (isSubCommandGroup(cmd)) parentCommand.addSubcommandGroup(cmd.group);
    else parentCommand.addSubcommand(cmd.subcommand);
  }

  logger.info(`Loaded ${commands.size} subcommand(s)/group(s) under /${PARENT_NAME}, ${standaloneCommands.size} standalone command(s)`);
  return { commands, standaloneCommands, parentCommand };
}
