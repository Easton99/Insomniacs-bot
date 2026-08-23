import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, getMatchStats, getPlayerById, getPlayerHistory } from '../services/faceit';
import { processMatchStats } from '../utils/match-utils';
import logger from '../utils/logger';

const SESSION_GAP_MS = 3 * 60 * 60 * 1000; // 3-hour gap = new session

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('session')
  .setDescription('Stats from the most recent play session')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;

  const linked = await db.discordUser.findUnique({ where: { discordId: target.id } });
  if (!linked) {
    await interaction.editReply({
      content: isSelf
        ? "You don't have a FACEIT account linked. Use `/ic link` to add one."
        : `<@${target.id}> hasn't linked a FACEIT account.`,
    });
    return;
  }

  let player, history;
  try {
    [player, history] = await Promise.all([
      getPlayerById(linked.faceitId),
      getPlayerHistory(linked.faceitId, 30),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic session');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!history.items.length) {
    await interaction.editReply({ content: `No recent matches found for **${player.nickname}**.` });
    return;
  }

  // Group most-recent matches into a session (stop when gap > 3h)
  const sessionItems = [history.items[0]];
  for (let i = 1; i < history.items.length; i++) {
    const prev = history.items[i - 1];
    const curr = history.items[i];
    const gap = (prev.started_at - curr.finished_at) * 1000;
    if (gap > SESSION_GAP_MS) break;
    sessionItems.push(curr);
  }

  // Fetch match stats for session matches
  const statsResults = await Promise.allSettled(sessionItems.map((m) => getMatchStats(m.match_id)));

  const processed = [];
  for (let i = 0; i < sessionItems.length; i++) {
    const r = statsResults[i];
    if (r.status === 'rejected') continue;
    const m = processMatchStats(r.value, linked.faceitId, sessionItems[i].started_at);
    if (m) processed.push(m);
  }

  if (!processed.length) {
    await interaction.editReply({ content: 'Could not load session stats right now.' });
    return;
  }

  const wins = processed.filter((m) => m.result === 'W').length;
  const losses = processed.length - wins;
  const totalKills = processed.reduce((s, m) => s + m.kills, 0);
  const totalDeaths = processed.reduce((s, m) => s + m.deaths, 0);
  const avgKd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : '∞';
  const avgHs = Math.round(processed.reduce((s, m) => s + m.hsPercent, 0) / processed.length);
  const bestGame = processed.reduce((best, m) => (m.kills > best.kills ? m : best));
  const maps = [...new Set(processed.map((m) => m.map))].join(', ');

  // ELO change (if available in match stats)
  const eloChanges = processed.map((m) => m.eloChange).filter((e): e is number => e !== null);
  const totalElo = eloChanges.length ? eloChanges.reduce((s, e) => s + e, 0) : null;

  const sessionStart = Math.min(...sessionItems.map((m) => m.started_at));
  const sessionEnd = Math.max(...sessionItems.map((m) => m.finished_at));

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`Last Session — ${processed.length} game${processed.length !== 1 ? 's' : ''}`)
    .addFields(
      { name: 'Record', value: `${wins}W  ${losses}L`, inline: true },
      { name: 'Avg K/D', value: avgKd, inline: true },
      { name: 'Avg HS%', value: `${avgHs}%`, inline: true },
      { name: 'Best Game', value: `${bestGame.kills}K ${bestGame.deaths}D on ${bestGame.map}`, inline: true },
      ...(totalElo !== null ? [{ name: 'ELO Change', value: `${totalElo >= 0 ? '+' : ''}${totalElo}`, inline: true }] : []),
      { name: 'Maps', value: maps },
      {
        name: 'Time',
        value: `<t:${sessionStart}:t> – <t:${sessionEnd}:t>  (<t:${sessionStart}:d>)`,
      },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
