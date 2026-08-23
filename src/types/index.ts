import {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ChatInputCommandInteraction,
  MessageContextMenuCommandInteraction,
  UserContextMenuCommandInteraction,
} from 'discord.js';

export interface SlashCommand {
  data: SlashCommandBuilder;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  execute(
    interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction,
  ): Promise<void>;
}

export type BotCommand = SlashCommand | ContextMenuCommand;

export function isSlashCommand(cmd: BotCommand): cmd is SlashCommand {
  return cmd.data instanceof SlashCommandBuilder;
}
