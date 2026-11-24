import {
  AutocompleteInteraction,
  SlashCommandSubcommandGroupBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from 'discord.js';

export interface SubCommand {
  subcommand: SlashCommandSubcommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** A group of subcommands under /ic, e.g. /ic movie add, /ic movie list. */
export interface SubCommandGroup {
  group: SlashCommandSubcommandGroupBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export type IcCommand = SubCommand | SubCommandGroup;

export function isSubCommandGroup(cmd: IcCommand): cmd is SubCommandGroup {
  return 'group' in cmd;
}

export interface StandaloneCommand {
  command: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  execute(
    interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction,
  ): Promise<void>;
}

export type BotCommand = SubCommand | StandaloneCommand | ContextMenuCommand;

export function isSubCommand(cmd: BotCommand): cmd is SubCommand {
  return 'subcommand' in cmd;
}

export function isStandaloneCommand(cmd: BotCommand): cmd is StandaloneCommand {
  return 'command' in cmd;
}
