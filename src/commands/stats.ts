import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, getPlayerById, getPlayerLifetimeStats } from '../services/faceit';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('stats')
  .setDescription('View FACEIT CS2 lifetime statistics')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;

  const linked = await db.discordUser.findUnique({ where: { discordId: target.id } });
  if (!linked) {
    const msg = isSelf
      ? "You don't have a FACEIT account linked. Use `/ic link` to add one."
      : `<@${target.id}> hasn't linked a FACEIT account.`;
    await interaction.editReply({ content: msg });
    return;
  }

  let player, stats;
  try {
    [player, stats] = await Promise.all([
      getPlayerById(linked.faceitId),
      getPlayerLifetimeStats(linked.faceitId),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic stats');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const cs2 = player.games?.cs2;
  const lt = stats.lifetime;

  const str = (key: string) => {
    const v = lt[key];
    return Array.isArray(v) ? v.join(',') : (v ?? '?');
  };

  const recentResults = lt['Recent Results'];
  const form = Array.isArray(recentResults)
    ? recentResults.map((r) => (r === '1' ? '✓' : '✗')).join('  ')
    : null;

  const currentStreak = parseInt(str('Current Win Streak'), 10);
  const streakDisplay = currentStreak > 0 ? `W${currentStreak}` : '—';

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle('CS2 Statistics')
    .addFields(
      { name: 'ELO', value: cs2 ? cs2.faceit_elo.toString() : '?', inline: true },
      { name: 'Level', value: cs2 ? cs2.skill_level.toString() : '?', inline: true },
      { name: 'Region', value: cs2?.region ?? '?', inline: true },
      { name: 'Matches', value: str('Matches'), inline: true },
      { name: 'Win Rate', value: `${str('Win Rate %')}%`, inline: true },
      { name: 'Wins', value: str('Wins'), inline: true },
      { name: 'K/D', value: str('Average K/D Ratio'), inline: true },
      { name: 'Headshots', value: `${str('Average Headshots %')}%`, inline: true },
      { name: 'Win Streak', value: streakDisplay, inline: true },
      { name: 'Best Streak', value: str('Longest Win Streak'), inline: true },
    );

  if (form) embed.addFields({ name: 'Last 5', value: form });

  if (player.avatar) embed.setThumbnail(player.avatar);
  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
