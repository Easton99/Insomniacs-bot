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
  formatHour,
  getZonedDate,
  isValidBirthday,
} from '../utils/birthday-utils';

const ACCENT = 0xff6b35;
const ERROR = 0xcc3333;
const LIST_LIMIT = 50;

type GuildInteraction = ChatInputCommandInteraction<'cached' | 'raw'>;

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('birthday')
  .setDescription('Set, remove or list birthdays — the bot posts a week before and on the day')
  .addStringOption((opt) =>
    opt
      .setName('action')
      .setDescription('What to do')
      .setRequired(true)
      .addChoices(
        { name: 'set — save a birthday', value: 'set' },
        { name: 'remove — delete a birthday', value: 'remove' },
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
  .addUserOption((opt) =>
    opt.setName('user').setDescription('(Admin) Set or remove someone else\'s birthday'),
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

function isAdmin(interaction: GuildInteraction): boolean {
  return (
    interaction.user.id === config.BOT_OWNER_ID ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/**
 * Resolves whose birthday is being changed. Returns null (after replying) if a
 * non-admin tries to change someone else's.
 */
async function resolveTarget(interaction: GuildInteraction): Promise<{ id: string; self: boolean } | null> {
  const user = interaction.options.getUser('user');
  if (!user || user.id === interaction.user.id) return { id: interaction.user.id, self: true };

  if (!isAdmin(interaction)) {
    await interaction.editReply({
      embeds: [errorEmbed('Permission denied', 'You need the **Manage Server** permission to change someone else\'s birthday.')],
    });
    return null;
  }
  if (user.bot) {
    await interaction.editReply({ embeds: [errorEmbed('Not allowed', 'Bots don\'t have birthdays.')] });
    return null;
  }
  return { id: user.id, self: false };
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

  const target = await resolveTarget(interaction);
  if (!target) return;

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

  const key = { guildId: interaction.guildId, discordId: target.id };
  const existing = await db.birthday.findUnique({ where: { guildId_discordId: key } });
  // Keep the "already posted" markers only if the date hasn't changed
  const unchanged = existing?.day === day && existing?.month === month;

  await db.birthday.upsert({
    where: { guildId_discordId: key },
    create: { ...key, day, month },
    update: {
      day,
      month,
      lastAnnouncedYear: unchanged ? existing?.lastAnnouncedYear : null,
      lastRemindedYear: unchanged ? existing?.lastRemindedYear : null,
    },
  });

  const settings = await db.guildSettings.findUnique({ where: { guildId: interaction.guildId } });
  const whose = target.self ? 'Your birthday is' : `<@${target.id}>'s birthday is`;
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🎂 Birthday saved')
    .setDescription(`${whose} set to **${formatBirthday(day, month)}**.`);

  if (!settings?.birthdayChannelId) {
    embed.setFooter({ text: 'No birthday channel is set for this server yet — ask an admin to run /ic birthday action:channel' });
  } else if (!unchanged && daysUntilBirthday(day, month, getZonedDate(config.BOT_TIMEZONE)) === 0) {
    embed.addFields({ name: 'That\'s today!', value: `Expect a message in <#${settings.birthdayChannelId}> shortly 🎉` });
  }

  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function handleRemove(interaction: GuildInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const target = await resolveTarget(interaction);
  if (!target) return;

  const { count } = await db.birthday.deleteMany({
    where: { guildId: interaction.guildId, discordId: target.id },
  });

  const whose = target.self ? 'Your' : `<@${target.id}>'s`;
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(count ? ACCENT : 0x888888)
        .setTitle(count ? 'Birthday removed' : 'No birthday saved')
        .setDescription(
          count
            ? `${whose} birthday has been removed from this server.`
            : `${target.self ? 'You don\'t' : `<@${target.id}> doesn't`} have a birthday saved in this server.`,
        ),
    ],
    allowedMentions: { parse: [] },
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

  if (!isAdmin(interaction)) {
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

  const zone = config.BOT_TIMEZONE === 'Europe/London' ? 'UK time' : config.BOT_TIMEZONE;
  const time = `${formatHour(config.BIRTHDAY_ANNOUNCE_HOUR)} ${zone}`;
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(channel ? 'Birthday channel set' : 'Birthday announcements turned off')
        .setDescription(
          channel
            ? `Birthday messages will be posted in <#${channel.id}> at ${time} — a reminder one week before, and a happy birthday on the day.`
            : 'No channel given, so birthday announcements are now turned off for this server.',
        ),
    ],
  });
}
