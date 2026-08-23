import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, getMatchStats, getPlayerById, getPlayerHistory } from '../services/faceit';
import { processMatchStats } from '../utils/match-utils';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('recent')
  .setDescription('View recent FACEIT CS2 matches')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt.setName('count').setDescription('Number of matches to show (default 10, max 20)').setRequired(false).setMinValue(1).setMaxValue(20),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;
  const count = interaction.options.getInteger('count') ?? 10;

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
      getPlayerHistory(linked.faceitId, count),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic recent');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!history.items.length) {
    await interaction.editReply({ content: `No recent matches found for **${player.nickname}**.` });
    return;
  }

  // Fetch match stats in parallel, tolerating individual failures
  const matchStatsResults = await Promise.allSettled(
    history.items.map((m) => getMatchStats(m.match_id)),
  );

  const rows: string[] = [];
  for (let i = 0; i < history.items.length; i++) {
    const item = history.items[i];
    const result = matchStatsResults[i];
    if (result.status === 'rejected') continue;

    const match = processMatchStats(result.value, linked.faceitId, item.started_at);
    if (!match) continue;

    const score = `${match.playerScore}/${match.opponentScore}`;
    const mapPad = match.map.padEnd(12).slice(0, 12);
    const scorePad = score.padStart(5);
    const kdPad = match.kd.padStart(4);
    rows.push(
      `${match.result}  ${mapPad}  ${scorePad}   K:${String(match.kills).padStart(2)} D:${String(match.deaths).padStart(2)}  KD:${kdPad}`,
    );
  }

  if (!rows.length) {
    await interaction.editReply({ content: 'Could not load match stats right now.' });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`Recent Matches  ·  ELO ${player.games?.cs2?.faceit_elo ?? '?'}  ·  Lvl ${player.games?.cs2?.skill_level ?? '?'}`)
    .setDescription('```' + '\nR  Map           Score   Kills     KD\n' + rows.join('\n') + '```')
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
