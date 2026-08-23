import { Collection, Interaction } from 'discord.js';
import { SubCommand } from '../types';
import logger from './logger';

export const LEADERBOARD_SELECT_ID = 'leaderboard_category';

export async function handleInteraction(
  interaction: Interaction,
  commands: Collection<string, SubCommand>,
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
