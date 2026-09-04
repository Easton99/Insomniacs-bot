import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, FaceitRateLimitError, getMatchStats, getPlayerById, getPlayerHistory } from '../services/faceit';
import { processMatchStats } from '../utils/match-utils';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('last')
  .setDescription('Show detailed stats from the most recent FACEIT match')
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
      getPlayerHistory(linked.faceitId, 1),
    ]);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic last');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!history.items.length) {
    await interaction.editReply({ content: `No recent matches found for **${player.nickname}**.` });
    return;
  }

  const item = history.items[0];

  let matchStats;
  try {
    matchStats = await getMatchStats(item.match_id);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    await interaction.editReply({ content: 'Could not load match stats right now. Try again in a moment.' });
    return;
  }

  const match = processMatchStats(matchStats, linked.faceitId, item.started_at);
  if (!match) {
    await interaction.editReply({ content: 'Could not process match stats.' });
    return;
  }

  const resultColor = match.result === 'W' ? 0x57f287 : 0xed4245;
  const resultLabel = match.result === 'W' ? 'Victory' : 'Defeat';
  const kdRatio = match.deaths > 0 ? (match.kills / match.deaths).toFixed(2) : '∞';
  const matchUrl = `https://www.faceit.com/en/cs2/room/${item.match_id}`;

  const embed = new EmbedBuilder()
    .setColor(resultColor)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`${resultLabel}  ·  ${match.map}  ·  ${match.playerScore} – ${match.opponentScore}`)
    .addFields(
      { name: 'Kills', value: String(match.kills), inline: true },
      { name: 'Deaths', value: String(match.deaths), inline: true },
      { name: 'Assists', value: String(match.assists), inline: true },
      { name: 'K/D', value: kdRatio, inline: true },
      { name: 'HS%', value: `${match.hsPercent}%`, inline: true },
      ...(match.eloChange !== null
        ? [{ name: 'ELO', value: `${match.eloChange >= 0 ? '+' : ''}${match.eloChange}`, inline: true }]
        : []),
      ...(match.pentaKills > 0 ? [{ name: '⭐ Ace', value: `${match.pentaKills}`, inline: true }] : []),
    )
    .addFields({ name: 'Match', value: `[View on FACEIT](${matchUrl})`, inline: true })
    .setFooter({ text: `Played` })
    .setTimestamp(item.started_at * 1000);

  await interaction.editReply({ embeds: [embed] });
}
