import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandSubcommandBuilder,
} from 'discord.js';
import { db } from '../database/client';
import { config } from '../config';
import {
  MONTH_NAMES,
  daysUntilBirthday,
  formatBirthday,
  getZonedDate,
  isValidBirthday,
} from '../utils/birthday-utils';

const ACCENT = 0xff6b35;
const ERROR = 0xcc3333;
const LIST_LIMIT = 50;

type GuildInteraction = ChatInputCommandInteraction<'cached' | 'raw'>;

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('birthday')
  .setDescription('Set, remove or list birthdays — the bot wishes happy birthday on the day')
  .addStringOption((opt) =>
    opt
      .setName('action')
      .setDescription('What to do')
      .setRequired(true)
      .addChoices(
        { name: 'set — save your birthday', value: 'set' },
        { name: 'remove — delete your birthday', value: 'remove' },
        { name: 'list — upcoming birthdays', value: 'list' },
        { name: 'channel — (admin) set the announcement channel', value: 'channel' },
      ),
  )
  .addIntegerOption((opt) =>
    opt.setName('day').setDescription('Day of the month (for set)').setMinValue(1).setMaxValue(31),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('month')
      .setDescription('Month (for set)')
      .addChoices(...MONTH_NAMES.map((name, i) => ({ name, value: i + 1 }))),
  )
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Channel for birthday messages (for channel; leave empty to turn off)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

function errorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(ERROR).setTitle(title).setDescription(description);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Birthdays can only be used inside a server.', ephemeral: true });
    return;
  }

  const action = interaction.options.getString('action', true);
  switch (action) {
    case 'set':
      return handleSet(interaction);
    case 'remove':
      return handleRemove(interaction);
    case 'list':
      return handleList(interaction);
    case 'channel':
      return handleChannel(interaction);
  }
}

async function handleSet(interaction: GuildInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const day = interaction.options.getInteger('day');
  const month = interaction.options.getInteger('month');

  if (day === null || month === null) {
    await interaction.editReply({
      embeds: [errorEmbed('Missing date', 'Provide both `day` and `month`, e.g. `/ic birthday action:set day:14 month:March`.')],
    });
    return;
  }
  if (!isValidBirthday(day, month)) {
    await interaction.editReply({
      embeds: [errorEmbed('Invalid date', `${MONTH_NAMES[month - 1]} doesn't have ${day} days.`)],
    });
    return;
  }

  const key = { guildId: interaction.guildId, discordId: interaction.user.id };
  const existing = await db.birthday.findUnique({ where: { guildId_discordId: key } });
  // Keep the "already announced" marker only if the date hasn't changed
  const unchanged = existing?.day === day && existing?.month === month;

  await db.birthday.upsert({
    where: { guildId_discordId: key },
    create: { ...key, day, month },
    update: { day, month, lastAnnouncedYear: unchanged ? existing?.lastAnnouncedYear : null },
  });

  const settings = await db.guildSettings.findUnique({ where: { guildId: interaction.guildId } });
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎂 Birthday saved')
    .setDescription(`Your birthday is set to **${formatBirthday(day, month)}**.`);

  if (!settings?.birthdayChannelId) {
    embed.setFooter({ text: 'No birthday channel is set for this server yet — ask an admin to run /ic birthday action:channel' });
  } else if (!unchanged && daysUntilBirthday(day, month, getZonedDate(config.BOT_TIMEZONE)) === 0) {
    embed.addFields({ name: 'That\'s today!', value: `Expect a message in <#${settings.birthdayChannelId}> shortly 🎉` });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction: GuildInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const { count } = await db.birthday.deleteMany({
    where: { guildId: interaction.guildId, discordId: interaction.user.id },
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(count ? ACCENT : 0x888888)
        .setTitle(count ? 'Birthday removed' : 'No birthday saved')
        .setDescription(
          count ? 'Your birthday has been removed from this server.' : 'You don\'t have a birthday saved in this server.',
        ),
    ],
  });
}

async function handleList(interaction: GuildInteraction): Promise<void> {
  await interaction.deferReply();

  const birthdays = await db.birthday.findMany({ where: { guildId: interaction.guildId } });

  if (birthdays.length === 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x888888)
          .setTitle('No birthdays yet')
          .setDescription('Nobody has saved a birthday here. Use `/ic birthday action:set` to add yours.'),
      ],
    });
    return;
  }

  const today = getZonedDate(config.BOT_TIMEZONE);
  const sorted = birthdays
    .map((b) => ({ ...b, daysUntil: daysUntilBirthday(b.day, b.month, today) }))
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const lines = sorted.slice(0, LIST_LIMIT).map((b) => {
    const when = b.daysUntil === 0 ? '🎉 **today**' : b.daysUntil === 1 ? 'tomorrow' : `in ${b.daysUntil} days`;
    return `<@${b.discordId}> — ${formatBirthday(b.day, b.month)} (${when})`;
  });

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎂 Upcoming birthdays')
    .setDescription(lines.join('\n'));

  if (sorted.length > LIST_LIMIT) embed.setFooter({ text: `Showing the next ${LIST_LIMIT} of ${sorted.length}` });

  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleChannel(interaction: GuildInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const isAdmin =
    interaction.user.id === config.BOT_OWNER_ID ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);

  if (!isAdmin) {
    await interaction.editReply({
      embeds: [errorEmbed('Permission denied', 'You need the **Manage Server** permission to change the birthday channel.')],
    });
    return;
  }

  const channel = interaction.options.getChannel('channel');
  const birthdayChannelId = channel?.id ?? null;

  await db.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    create: { guildId: interaction.guildId, birthdayChannelId },
    update: { birthdayChannelId },
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(channel ? 'Birthday channel set' : 'Birthday announcements turned off')
        .setDescription(
          channel
            ? `Birthday messages will be posted in <#${channel.id}> from ${config.BIRTHDAY_ANNOUNCE_HOUR}:00 (${config.BOT_TIMEZONE}).`
            : 'No channel given, so birthday announcements are now turned off for this server.',
        ),
    ],
  });
}
