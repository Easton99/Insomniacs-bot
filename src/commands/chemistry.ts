import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, getPlayerById, getPlayerHistory } from '../services/faceit';
import { config } from '../config';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('chemistry')
  .setDescription('Duo win rates and teammate performance with other linked players')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  );

interface TeammateStats {
  faceitId: string;
  nickname: string;
  games: number;
  wins: number;
}

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

  // Get all other linked players to track
  const allLinked = await db.discordUser.findMany({ where: { discordId: { not: target.id } } });
  if (!allLinked.length) {
    await interaction.editReply({ content: 'No other linked players to compare chemistry with yet.' });
    return;
  }

  const linkedMap = new Map(allLinked.map((u) => [u.faceitId, u.faceitNickname]));

  let player, history;
  try {
    [player, history] = await Promise.all([
      getPlayerById(linked.faceitId),
      getPlayerHistory(linked.faceitId, 100),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic chemistry');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  // Minimum shared matches required (from config)
  const minMatches = config.CHEMISTRY_MIN_MATCHES;
  const teammates = new Map<string, TeammateStats>();

  for (const item of history.items) {
    const teams = Object.values(item.teams ?? {});
    const playerTeam = teams.find((t) => t.players?.some((p) => p.player_id === linked.faceitId));
    if (!playerTeam) continue;

    const won = item.results?.winner === playerTeam.faction_id;

    for (const p of playerTeam.players ?? []) {
      if (!linkedMap.has(p.player_id)) continue;
      const entry = teammates.get(p.player_id) ?? {
        faceitId: p.player_id,
        nickname: linkedMap.get(p.player_id) ?? p.nickname,
        games: 0,
        wins: 0,
      };
      entry.games++;
      if (won) entry.wins++;
      teammates.set(p.player_id, entry);
    }
  }

  if (!teammates.size) {
    await interaction.editReply({
      content: `No games with other linked players found in **${player.nickname}**'s last ${history.items.length} matches.`,
    });
    return;
  }

  const sorted = [...teammates.values()].sort((a, b) => b.games - a.games);
  const qualified = sorted.filter((t) => t.games >= minMatches);

  const bestTeammate = qualified.length
    ? qualified.reduce((best, t) => (t.wins / t.games > best.wins / best.games ? t : best))
    : null;
  const worstTeammate = qualified.length
    ? qualified.reduce((worst, t) => (t.wins / t.games < worst.wins / worst.games ? t : worst))
    : null;
  const mostPlayed = sorted[0];

  const tableRows = sorted
    .map((t) => {
      const wr = Math.round((t.wins / t.games) * 100);
      const name = t.nickname.padEnd(16).slice(0, 16);
      const games = String(t.games).padStart(3);
      const wrStr = `${wr}%`.padStart(4);
      const note = t.games < minMatches ? ' *' : '';
      return `${name}  ${games}G   ${wrStr}${note}`;
    });

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle('Teammate Chemistry')
    .addFields(
      { name: 'Most Played With', value: `**${mostPlayed.nickname}** — ${mostPlayed.games} games`, inline: true },
      ...(bestTeammate ? [{ name: 'Best Duo', value: `**${bestTeammate.nickname}** — ${Math.round((bestTeammate.wins / bestTeammate.games) * 100)}% WR`, inline: true }] : []),
      ...(worstTeammate && worstTeammate !== bestTeammate ? [{ name: 'Worst Duo', value: `**${worstTeammate.nickname}** — ${Math.round((worstTeammate.wins / worstTeammate.games) * 100)}% WR`, inline: true }] : []),
    )
    .addFields({
      name: 'All Teammates',
      value: '```\nTeammate          Games   WR\n' + tableRows.join('\n') + '\n```',
    })
    .setFooter({ text: `Last ${history.items.length} matches  ·  * = under ${minMatches}-game sample` })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
