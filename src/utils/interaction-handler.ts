import { Collection, Interaction } from 'discord.js';
import { SubCommand, StandaloneCommand } from '../types';
import { FaceitRateLimitError } from '../services/faceit';
import logger from './logger';

export const LEADERBOARD_SELECT_ID = 'leaderboard_category';

export async function handleInteraction(
  interaction: Interaction,
  commands: Collection<string, SubCommand>,
  standaloneCommands: Collection<string, StandaloneCommand>,
): Promise<void> {
  if (interaction.isChatInputCommand() && interaction.commandName === 'ic') {
    const subcommandName = interaction.options.getSubcommand();
    const command = commands.get(subcommandName);

    if (!command) {
      logger.warn({ subcommand: subcommandName }, 'Received unknown subcommand');
      return;
    }

    logger.info(
      { command: `ic ${subcommandName}`, user: interaction.user.tag, guild: interaction.guildId },
      'Command executed',
    );

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error({ err, command: subcommandName }, 'Command execution failed');
      if (err instanceof FaceitRateLimitError) {
        await replyWithRateLimit(interaction, err);
      } else {
        await replyWithError(interaction);
      }
    }
  } else if (interaction.isChatInputCommand()) {
    const commandName = interaction.commandName;
    const command = standaloneCommands.get(commandName);

    if (!command) {
      logger.warn({ command: commandName }, 'Received unknown standalone command');
      return;
    }

    logger.info(
      { command: commandName, user: interaction.user.tag, guild: interaction.guildId },
      'Command executed',
    );

    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error({ err, command: commandName }, 'Command execution failed');
      await replyWithError(interaction);
    }
  } else if (interaction.isStringSelectMenu() && interaction.customId === LEADERBOARD_SELECT_ID) {
    logger.info({ user: interaction.user.tag, value: interaction.values[0] }, 'Leaderboard category changed');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { handleSelectMenu } = require('../commands/leaderboard') as {
        handleSelectMenu(i: typeof interaction): Promise<void>;
      };
      await handleSelectMenu(interaction);
    } catch (error) {
      logger.error({ error }, 'Leaderboard select menu handler failed');
      await replyWithError(interaction);
    }
  }
}

async function replyWithRateLimit(
  interaction: {
    replied: boolean;
    deferred: boolean;
    reply(options: object): Promise<unknown>;
    editReply(options: object): Promise<unknown>;
    followUp(options: object): Promise<unknown>;
  },
  err: FaceitRateLimitError,
): Promise<void> {
  const resetPart = err.resetsAt
    ? ` Resets <t:${Math.floor(err.resetsAt / 1000)}:R>.`
    : '';
  const content = `The FACEIT API rate limit has been reached.${resetPart}`;
  try {
    if (interaction.replied) {
      await interaction.followUp({ content, ephemeral: true });
    } else if (interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (replyError) {
    logger.error({ replyError }, 'Failed to send rate limit response to user');
  }
}

async function replyWithError(interaction: {
  replied: boolean;
  deferred: boolean;
  reply(options: { content: string; ephemeral: boolean }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
  followUp(options: { content: string; ephemeral: boolean }): Promise<unknown>;
}): Promise<void> {
  const content = 'Something went wrong. Please try again.';
  try {
    if (interaction.replied) {
      await interaction.followUp({ content, ephemeral: true });
    } else if (interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (replyError) {
    logger.error({ replyError }, 'Failed to send error response to user');
  }
}
