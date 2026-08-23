import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import {
  FaceitApiError,
  getMatchStats,
  getPlayerById,
  getPlayerHistory,
  getPlayerLifetimeStats,
} from '../services/faceit';
import { processMatchStats } from '../utils/match-utils';
import { config } from '../config';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('achievements')
  .setDescription('View earned achievements calculated from match history')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  );

function isLateNight(startedAt: number, timezone: string): boolean {
  try {
    const date = new Date(startedAt * 1000);
    if (isNaN(date.getTime())) return false;
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(date);
    const hour = parseInt(hourStr, 10);
    if (isNaN(hour)) return false;
    return hour >= 23 || hour <= 4;
  } catch {
    return false;
  }
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

  // Phase 1: lightweight calls
  let player, lifetimeStats, history;
  try {
    [player, lifetimeStats, history] = await Promise.all([
      getPlayerById(linked.faceitId),
      getPlayerLifetimeStats(linked.faceitId),
      getPlayerHistory(linked.faceitId, 100),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic achievements (phase 1)');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const lt = lifetimeStats.lifetime;
  const totalMatches = parseInt((lt['Matches'] as string) ?? '0', 10);
  const currentStreak = parseInt((lt['Current Win Streak'] as string) ?? '0', 10);
  const longestStreak = parseInt((lt['Longest Win Streak'] as string) ?? '0', 10);

  const historyItems = history.items ?? [];

  // Loss streak + late-night from history items (no extra API calls needed)
  let lossStreak = 0;
  let maxLossStreak = 0;
  let lateNightCount = 0;

  for (const item of historyItems) {
    const teams = Object.values(item.teams ?? {});
    const playerTeam = teams.find((t) => t.players?.some((p) => p.player_id === linked.faceitId));
    const won = item.results?.winner != null && item.results.winner === playerTeam?.faction_id;

    if (won) {
      lossStreak = 0;
    } else {
      lossStreak++;
      if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
    }

    if (item.started_at && isLateNight(item.started_at, config.BOT_TIMEZONE)) {
      lateNightCount++;
    }
  }

  // Phase 2: match stats for kill-based achievements (first 50 history items)
  let bestKills = 0;
  let bestKillsMap = '?';
  let bestKillsInLoss = 0;
  let bestKillsInLossMap = '?';
  let hasPenta = false;

  const statsItems = historyItems.slice(0, 50);
  if (statsItems.length > 0) {
    const statsResults = await Promise.allSettled(statsItems.map((m) => getMatchStats(m.match_id)));

    for (let i = 0; i < statsItems.length; i++) {
      const r = statsResults[i];
      if (r.status === 'rejected') continue;

      const m = processMatchStats(r.value, linked.faceitId, statsItems[i].started_at ?? 0);
      if (!m) continue;

      if (m.kills > bestKills) {
        bestKills = m.kills;
        bestKillsMap = m.map;
      }
      if (m.result === 'L' && m.kills > bestKillsInLoss) {
        bestKillsInLoss = m.kills;
        bestKillsInLossMap = m.map;
      }
      if (m.pentaKills > 0) hasPenta = true;
    }
  }

  // Evaluate achievements
  const earned: Array<{ icon: string; name: string; detail: string }> = [];

  if (totalMatches >= 500) earned.push({ icon: '⚔️', name: 'Veteran', detail: `${totalMatches} matches played` });
  else if (totalMatches >= 100) earned.push({ icon: '🎮', name: 'Century Club', detail: `${totalMatches} matches played` });

  if (longestStreak >= 10) earned.push({ icon: '🚀', name: 'Unstoppable', detail: `${longestStreak}-game best win streak` });
  if (currentStreak >= 3) earned.push({ icon: '🔥', name: 'On Fire', detail: `Currently on a ${currentStreak}-game win streak` });
  if (maxLossStreak >= 5) earned.push({ icon: '😤', name: 'Tilt Queue', detail: `${maxLossStreak}-game loss streak` });

  if (lateNightCount >= 10) earned.push({ icon: '🦉', name: 'The Insomniac', detail: `${lateNightCount} late-night matches (11 PM – 5 AM)` });
  else if (lateNightCount >= 1) earned.push({ icon: '🌙', name: 'Go To Bed', detail: `${lateNightCount} late-night match${lateNightCount !== 1 ? 'es' : ''} (11 PM – 5 AM)` });

  if (bestKills >= 35) earned.push({ icon: '🤯', name: 'Thirty-Five?!', detail: `${bestKills}K on ${bestKillsMap}` });
  else if (bestKills >= 30) earned.push({ icon: '💣', name: 'Thirty Bomb', detail: `${bestKills}K on ${bestKillsMap}` });

  if (bestKillsInLoss >= 30) earned.push({ icon: '🏋️', name: 'The Hard Carry', detail: `${bestKillsInLoss}K in a losing match on ${bestKillsInLossMap}` });
  if (hasPenta) earned.push({ icon: '⭐', name: 'Ace', detail: 'Got a penta kill' });

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`Achievements — ${earned.length} earned`)
    .setDescription(
      earned.length
        ? earned.map((a) => `${a.icon}  **${a.name}**\n${a.detail}`).join('\n\n')
        : 'No achievements unlocked yet. Keep playing!',
    )
    .setFooter({ text: `Kill achievements: last ${statsItems.length} matches  ·  Streak/late-night: last ${historyItems.length}` })
    .setTimestamp();

  if (player.avatar) embed.setThumbnail(player.avatar);

  await interaction.editReply({ embeds: [embed] });
}
