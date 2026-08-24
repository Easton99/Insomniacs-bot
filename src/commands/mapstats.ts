import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, FaceitRateLimitError, getPlayerById } from '../services/faceit';
import { fetchMatchesWithStats, normaliseMapName } from '../utils/match-utils';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('mapstats')
  .setDescription('Detailed statistics for a specific map')
  .addStringOption((opt) =>
    opt.setName('map').setDescription('Map name (e.g. Mirage, Inferno, Dust2)').setRequired(true),
  )
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const mapInput = interaction.options.getString('map', true);
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

  let player, allMatches;
  try {
    [player, allMatches] = await Promise.all([
      getPlayerById(linked.faceitId),
      fetchMatchesWithStats(linked.faceitId, 100),
    ]);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic mapstats');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const target_key = normaliseMapName(mapInput);
  const matches = allMatches.filter((m) => normaliseMapName(m.map) === target_key);

  if (!matches.length) {
    const maps = [...new Set(allMatches.map((m) => m.map))].join(', ');
    await interaction.editReply({
      content: `No matches found on **${mapInput}** in the last ${allMatches.length} games.\nMaps played: ${maps || 'none'}`,
    });
    return;
  }

  const wins = matches.filter((m) => m.result === 'W').length;
  const losses = matches.length - wins;
  const wr = Math.round((wins / matches.length) * 100);
  const totalKills = matches.reduce((s, m) => s + m.kills, 0);
  const totalDeaths = matches.reduce((s, m) => s + m.deaths, 0);
  const avgKills = (totalKills / matches.length).toFixed(1);
  const avgDeaths = (totalDeaths / matches.length).toFixed(1);
  const avgKd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : '∞';
  const avgHs = Math.round(matches.reduce((s, m) => s + m.hsPercent, 0) / matches.length);
  const bestGame = matches.reduce((best, m) => (m.kills > best.kills ? m : best));

  const mapName = matches[0].map;

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`${mapName} — Map Stats`)
    .addFields(
      { name: 'Games', value: matches.length.toString(), inline: true },
      { name: 'Record', value: `${wins}W  ${losses}L`, inline: true },
      { name: 'Win Rate', value: `${wr}%`, inline: true },
      { name: 'Avg Kills', value: avgKills, inline: true },
      { name: 'Avg Deaths', value: avgDeaths, inline: true },
      { name: 'Avg K/D', value: avgKd, inline: true },
      { name: 'Avg HS%', value: `${avgHs}%`, inline: true },
      { name: 'Best Game', value: `${bestGame.kills}K ${bestGame.deaths}D (${bestGame.result})`, inline: true },
    )
    .setFooter({ text: `From last ${allMatches.length} matches` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
