import {
  SlashCommandSubcommandBuilder,
  ContextMenuCommandBuilder,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from 'discord.js';

export interface SubCommand {
  subcommand: SlashCommandSubcommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  execute(
    interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction,
  ): Promise<void>;
}

export type BotCommand = SubCommand | ContextMenuCommand;

export function isSubCommand(cmd: BotCommand): cmd is SubCommand {
  return 'subcommand' in cmd;
}
