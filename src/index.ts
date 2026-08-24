import { ChannelType, Client, EmbedBuilder, Events, GatewayIntentBits, PermissionFlagsBits, REST, Routes, TextChannel } from 'discord.js';
import { config } from './config';
import logger from './utils/logger';
import { connectDatabase, disconnectDatabase } from './database/client';
import { loadCommands } from './utils/command-loader';
import { handleInteraction } from './utils/interaction-handler';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function main(): Promise<void> {
  logger.info('Starting Insomniacs Bot…');

  try {
    await connectDatabase();
  } catch (dbError: unknown) {
    logger.warn({ dbError }, 'Database unavailable — bot will start without DB (commands requiring storage will fail)');
  }

  const { commands, standaloneCommands } = loadCommands();

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, 'Bot online');
  });

  client.on(Events.GuildCreate, (guild) => {
    const rest = new REST().setToken(config.DISCORD_TOKEN);
    const { standaloneCommands, parentCommand } = loadCommands();
    const commandData = [parentCommand.toJSON(), ...standaloneCommands.map((c) => c.command.toJSON())];
    rest
      .put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guild.id), { body: commandData })
      .then(() => logger.info({ guildId: guild.id, name: guild.name }, 'Registered commands to new guild'))
      .catch((err: unknown) => logger.error({ err, guildId: guild.id }, 'Failed to register commands to new guild'));

    const targetChannel = guild.systemChannel ?? guild.channels.cache
      .filter((ch): ch is TextChannel => ch.type === ChannelType.GuildText)
      .filter((ch) => guild.members.me ? ch.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages) : false)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first();

    if (!targetChannel) {
      logger.warn({ guildId: guild.id }, 'No suitable channel to send welcome message');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xff6b35)
      .setTitle('👋 Thanks for adding Insomniacs Bot!')
      .setDescription('A Discord bot built for friend groups. Check CS2 stats, run polls, and more.')
      .addFields(
        { name: '🌐 Website', value: '[hipphamster.online](https://www.hipphamster.online)', inline: true },
        { name: '📖 Commands', value: '[All commands](https://www.hipphamster.online/commands.html)', inline: true },
        { name: '💡 Feature Requests', value: '[Suggest something](https://www.hipphamster.online/feature-request.html)', inline: true },
      )
      .setFooter({ text: 'Use /ic help to see all available commands' })
      .setTimestamp();

    targetChannel.send({ embeds: [embed] })
      .then(() => logger.info({ guildId: guild.id, channelId: targetChannel.id }, 'Sent welcome message'))
      .catch((err: unknown) => logger.error({ err, guildId: guild.id }, 'Failed to send welcome message'));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    logger.debug(
      { type: interaction.type, commandName: 'commandName' in interaction ? interaction.commandName : undefined },
      'Interaction received',
    );
    handleInteraction(interaction, commands, standaloneCommands).catch((error: unknown) => {
      logger.error({ error }, 'Unhandled error in interaction handler');
    });
  });

  await client.login(config.DISCORD_TOKEN);
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down…');
  void client.destroy();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown().catch((error: unknown) => logger.error({ error }, 'Error during shutdown'));
});
process.on('SIGTERM', () => {
  void shutdown().catch((error: unknown) => logger.error({ error }, 'Error during shutdown'));
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception — exiting');
  process.exit(1);
});

main().catch((error: unknown) => {
  logger.error({ error }, 'Fatal startup error');
  process.exit(1);
});
