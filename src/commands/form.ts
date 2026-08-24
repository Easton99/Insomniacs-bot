import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, FaceitRateLimitError, getMatchStats, getPlayerById, getPlayerHistory } from '../services/faceit';
import { processMatchStats, type ProcessedMatch } from '../utils/match-utils';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('form')
  .setDescription('Aggregated performance summary over recent matches')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('matches')
      .setDescription('Number of matches to analyse (default 20, max 40)')
      .setRequired(false)
      .setMinValue(5)
      .setMaxValue(40),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;
  const matchCount = interaction.options.getInteger('matches') ?? 20;

  const linked = await db.discordUser.findUnique({ where: { discordId: target.id } });
  if (!linked) {
    const msg = isSelf
      ? "You don't have a FACEIT account linked. Use `/ic link` to add one."
      : `<@${target.id}> hasn't linked a FACEIT account.`;
    await interaction.editReply({ content: msg });
    return;
  }

  let player, history;
  try {
    [player, history] = await Promise.all([
      getPlayerById(linked.faceitId),
      getPlayerHistory(linked.faceitId, matchCount),
    ]);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic form');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!history.items.length) {
    await interaction.editReply({ content: `No recent matches found for **${player.nickname}**.` });
    return;
  }

  const matchStatsResults = await Promise.allSettled(
    history.items.map((m) => getMatchStats(m.match_id)),
  );

  const matches: ProcessedMatch[] = [];
  for (let i = 0; i < history.items.length; i++) {
    const item = history.items[i];
    const result = matchStatsResults[i];
    if (result.status === 'rejected') continue;
    const match = processMatchStats(result.value, linked.faceitId, item.started_at);
    if (match) matches.push(match);
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
  const avgKills = (totalKills / matches.length).toFixed(1);
  const avgDeaths = (totalDeaths / matches.length).toFixed(1);
  const avgKd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : '∞';
  const avgHs = Math.round(matches.reduce((s, m) => s + m.hsPercent, 0) / matches.length);

  const bestMatch = matches.reduce((best, m) => (m.kills > best.kills ? m : best));
  const worstMatch = matches.reduce((worst, m) => (m.kills < worst.kills ? m : worst));

  // Recent form (last 5)
  const recentForm = matches
    .slice(0, 5)
    .map((m) => (m.result === 'W' ? '✓' : '✗'))
    .join('  ');

  // Map breakdown
  const mapCounts = new Map<string, { w: number; l: number }>();
  for (const m of matches) {
    const entry = mapCounts.get(m.map) ?? { w: 0, l: 0 };
    if (m.result === 'W') entry.w++;
    else entry.l++;
    mapCounts.set(m.map, entry);
  }
  const topMaps = [...mapCounts.entries()]
    .sort((a, b) => b[1].w + b[1].l - (a[1].w + a[1].l))
    .slice(0, 5)
    .map(([map, { w, l }]) => `${map} ${w}W/${l}L`)
    .join('  ·  ');

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`Form — Last ${matches.length} Matches`)
    .addFields(
      { name: 'Record', value: `${wins}W  ${losses}L`, inline: true },
      { name: 'Win Rate', value: `${winRate}%`, inline: true },
      { name: 'Current ELO', value: player.games?.cs2?.faceit_elo.toString() ?? '?', inline: true },
      { name: 'Avg Kills', value: avgKills, inline: true },
      { name: 'Avg Deaths', value: avgDeaths, inline: true },
      { name: 'Avg K/D', value: avgKd, inline: true },
      { name: 'Avg HS%', value: `${avgHs}%`, inline: true },
      { name: 'Best Game', value: `${bestMatch.kills}K on ${bestMatch.map}`, inline: true },
      { name: 'Worst Game', value: `${worstMatch.kills}K on ${worstMatch.map}`, inline: true },
      { name: 'Last 5', value: recentForm },
      { name: 'Maps', value: topMaps || '—' },
    )
    .setTimestamp();

  if (player.avatar) embed.setThumbnail(player.avatar);

  await interaction.editReply({ embeds: [embed] });
}
