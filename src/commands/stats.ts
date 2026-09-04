import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import {
  FaceitApiError,
  FaceitRateLimitError,
  getMatchStats,
  getPlayerById,
  getPlayerHistory,
  getPlayerLifetimeStats,
} from '../services/faceit';
import { processMatchStats } from '../utils/match-utils';
import logger from '../utils/logger';

const PERIODS: Record<string, { label: string; days: number }> = {
  week:    { label: 'Last 7 days',    days: 7  },
  month:   { label: 'Last 30 days',   days: 30 },
  '3months': { label: 'Last 3 months', days: 90 },
};

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('stats')
  .setDescription('View FACEIT CS2 statistics')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName('period')
      .setDescription('Time period (default: lifetime)')
      .setRequired(false)
      .addChoices(
        { name: 'Last 7 days',    value: 'week'    },
        { name: 'Last 30 days',   value: 'month'   },
        { name: 'Last 3 months',  value: '3months' },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;
  const period = interaction.options.getString('period') ?? null;

  const linked = await db.discordUser.findUnique({ where: { discordId: target.id } });
  if (!linked) {
    await interaction.editReply({
      content: isSelf
        ? "You don't have a FACEIT account linked. Use `/ic link` to add one."
        : `<@${target.id}> hasn't linked a FACEIT account.`,
    });
    return;
  }

  if (period) {
    await executePeriod(interaction, linked.faceitId, period);
  } else {
    await executeLifetime(interaction, linked.faceitId);
  }
}

async function executeLifetime(interaction: ChatInputCommandInteraction, faceitId: string): Promise<void> {
  let player, stats;
  try {
    [player, stats] = await Promise.all([getPlayerById(faceitId), getPlayerLifetimeStats(faceitId)]);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic stats (lifetime)');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const cs2 = player.games?.cs2;
  const lt = stats.lifetime;

  const str = (key: string): string => {
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
    .setTitle('FACEIT CS2 Statistics — Lifetime')
    .addFields(
      { name: 'ELO',        value: cs2 ? cs2.faceit_elo.toString() : '?', inline: true },
      { name: 'Level',      value: cs2 ? cs2.skill_level.toString() : '?', inline: true },
      { name: 'Region',     value: cs2?.region ?? '?',                     inline: true },
      { name: 'Matches',    value: str('Matches'),                          inline: true },
      { name: 'Win Rate',   value: `${str('Win Rate %')}%`,                inline: true },
      { name: 'Wins',       value: str('Wins'),                             inline: true },
      { name: 'K/D',        value: str('Average K/D Ratio'),                inline: true },
      { name: 'Headshots',  value: `${str('Average Headshots %')}%`,        inline: true },
      { name: 'Win Streak', value: streakDisplay,                           inline: true },
      { name: 'Best Streak', value: str('Longest Win Streak'),              inline: true },
    );

  if (form) embed.addFields({ name: 'Last 5', value: form });
  if (player.avatar) embed.setThumbnail(player.avatar);
  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function executePeriod(
  interaction: ChatInputCommandInteraction,
  faceitId: string,
  periodKey: string,
): Promise<void> {
  const { label, days } = PERIODS[periodKey]!;
  const fromTs = Math.floor(Date.now() / 1000) - days * 86400;

  let player, history;
  try {
    [player, history] = await Promise.all([
      getPlayerById(faceitId),
      getPlayerHistory(faceitId, 100, 0, fromTs),
    ]);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic stats (period)');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!history.items.length) {
    await interaction.editReply({ content: `No matches found for **${player.nickname}** in the ${label.toLowerCase()}.` });
    return;
  }

  const statsResults = await Promise.allSettled(history.items.map((m) => getMatchStats(m.match_id)));

  const matches = [];
  for (let i = 0; i < history.items.length; i++) {
    const r = statsResults[i];
    if (r.status === 'rejected') continue;
    const m = processMatchStats(r.value, faceitId, history.items[i].started_at);
    if (m) matches.push(m);
  }

  if (!matches.length) {
    await interaction.editReply({ content: 'Could not load match stats right now.' });
    return;
  }

  const wins = matches.filter((m) => m.result === 'W').length;
  const losses = matches.length - wins;
  const winRate = Math.round((wins / matches.length) * 100);
  const totalKills = matches.reduce((s, m) => s + m.kills, 0);
  const totalDeaths = matches.reduce((s, m) => s + m.deaths, 0);
  const avgKd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : '∞';
  const avgHs = Math.round(matches.reduce((s, m) => s + m.hsPercent, 0) / matches.length);
  const avgKills = (totalKills / matches.length).toFixed(1);

  const eloChanges = matches.map((m) => m.eloChange).filter((e): e is number => e !== null);
  const totalElo = eloChanges.length > 0 ? eloChanges.reduce((s, e) => s + e, 0) : null;

  const cs2 = player.games?.cs2;

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`FACEIT CS2 Statistics — ${label}`)
    .addFields(
      { name: 'ELO',       value: cs2 ? cs2.faceit_elo.toString() : '?', inline: true },
      { name: 'Level',     value: cs2 ? cs2.skill_level.toString() : '?', inline: true },
      ...(totalElo !== null
        ? [{ name: 'ELO Change', value: `${totalElo >= 0 ? '+' : ''}${totalElo}`, inline: true }]
        : []),
      { name: 'Matches',   value: String(matches.length),                 inline: true },
      { name: 'Record',    value: `${wins}W  ${losses}L`,                 inline: true },
      { name: 'Win Rate',  value: `${winRate}%`,                          inline: true },
      { name: 'K/D',       value: avgKd,                                  inline: true },
      { name: 'Avg Kills', value: avgKills,                               inline: true },
      { name: 'Avg HS%',   value: `${avgHs}%`,                           inline: true },
    );

  if (player.avatar) embed.setThumbnail(player.avatar);
  embed.setFooter({ text: history.items.length === 100 ? 'Showing up to 100 matches' : `${matches.length} matches` });
  embed.setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
