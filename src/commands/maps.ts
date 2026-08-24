import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, FaceitRateLimitError, getPlayerById } from '../services/faceit';
import { fetchMatchesWithStats } from '../utils/match-utils';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('maps')
  .setDescription('Per-map win rate and K/D breakdown')
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

  let player, matches;
  try {
    [player, matches] = await Promise.all([
      getPlayerById(linked.faceitId),
      fetchMatchesWithStats(linked.faceitId, 50),
    ]);
  } catch (err) {
    if (err instanceof FaceitRateLimitError) throw err;
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic maps');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!matches.length) {
    await interaction.editReply({ content: `No recent matches found for **${player.nickname}**.` });
    return;
  }

  // Aggregate by map
  const mapData = new Map<string, { wins: number; losses: number; kills: number; deaths: number }>();
  for (const m of matches) {
    const entry = mapData.get(m.map) ?? { wins: 0, losses: 0, kills: 0, deaths: 0 };
    if (m.result === 'W') entry.wins++;
    else entry.losses++;
    entry.kills += m.kills;
    entry.deaths += m.deaths;
    mapData.set(m.map, entry);
  }

  const rows = [...mapData.entries()]
    .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
    .map(([map, d]) => {
      const games = d.wins + d.losses;
      const wr = Math.round((d.wins / games) * 100);
      const kd = d.deaths > 0 ? (d.kills / d.deaths).toFixed(2) : '∞';
      const mapPad = map.padEnd(12).slice(0, 12);
      const gamesPad = String(games).padStart(3);
      const wrPad = `${wr}%`.padStart(4);
      const kdPad = kd.padStart(5);
      return `${mapPad}  ${gamesPad}G  ${d.wins}W ${d.losses}L  ${wrPad}  ${kdPad}`;
    });

  const header = 'Map           Games   W  L    WR%     KD';
  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle('Map Breakdown')
    .setDescription('```\n' + header + '\n' + rows.join('\n') + '\n```')
    .setFooter({ text: `Based on last ${matches.length} matches` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
