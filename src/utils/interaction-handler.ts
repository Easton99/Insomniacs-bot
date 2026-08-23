import { Collection, Interaction } from 'discord.js';
import { BotCommand, isSlashCommand } from '../types';
import logger from './logger';

export async function handleInteraction(
  interaction: Interaction,
  commands: Collection<string, BotCommand>,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);

    if (!command || !isSlashCommand(command)) {
      logger.warn({ commandName: interaction.commandName }, 'Received unknown slash command');
      return;
    }

    logger.info(
      { command: interaction.commandName, user: interaction.user.tag, guild: interaction.guildId },
      'Command executed',
    );

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error({ error, command: interaction.commandName }, 'Command execution failed');
      await replyWithError(interaction);
    }
    return;
  }

  if (interaction.isMessageContextMenuCommand() || interaction.isUserContextMenuCommand()) {
    const command = commands.get(interaction.commandName);

    if (!command || isSlashCommand(command)) {
      logger.warn({ commandName: interaction.commandName }, 'Received unknown context menu command');
      return;
    }

    logger.info(
      { command: interaction.commandName, user: interaction.user.tag },
      'Context menu command executed',
    );

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error({ error, command: interaction.commandName }, 'Context menu command failed');
    }
  }
}

async function replyWithError(interaction: {
  replied: boolean;
  deferred: boolean;
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  followUp(options: { content: string; ephemeral: boolean }): Promise<unknown>;
}): Promise<void> {
  const message = { content: 'Something went wrong. Please try again.', ephemeral: true };
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(message);
    } else {
      await interaction.reply(message);
    }
  } catch (replyError) {
    logger.error({ replyError }, 'Failed to send error response to user');
  }
}
