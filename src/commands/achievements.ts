import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, getPlayerById, getPlayerHistory, getPlayerLifetimeStats } from '../services/faceit';
import { fetchMatchesWithStats } from '../utils/match-utils';
import { config } from '../config';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('achievements')
  .setDescription('View earned achievements calculated from match history')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to look up (defaults to you)').setRequired(false),
  );

function isLateNight(startedAt: number, timezone: string): boolean {
  const date = new Date(startedAt * 1000);
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(date),
    10,
  );
  return hour >= 23 || hour <= 4;
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

  let player, lifetimeStats, history, matchStats;
  try {
    [player, lifetimeStats, history, matchStats] = await Promise.all([
      getPlayerById(linked.faceitId),
      getPlayerLifetimeStats(linked.faceitId),
      getPlayerHistory(linked.faceitId, 100),
      fetchMatchesWithStats(linked.faceitId, 50),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic achievements');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const lt = lifetimeStats.lifetime;
  const totalMatches = parseInt((lt['Matches'] as string) ?? '0', 10);
  const currentStreak = parseInt((lt['Current Win Streak'] as string) ?? '0', 10);
  const longestStreak = parseInt((lt['Longest Win Streak'] as string) ?? '0', 10);

  // Loss streak from history
  let lossStreak = 0;
  let maxLossStreak = 0;
  for (const item of history.items) {
    const playerTeam = item.teams.find((t) => t.players.some((p) => p.player_id === linked.faceitId));
    const won = item.results?.winner === playerTeam?.faction_id;
    if (!won) {
      lossStreak++;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
    }
  }

  // Late-night count
  const lateNightMatches = history.items.filter((m) => isLateNight(m.started_at, config.BOT_TIMEZONE));

  // Kill-based achievements from match stats
  let bestKills = 0;
  let bestKillsMap = '?';
  let bestKillsLoss = 0;
  let bestKillsLossMap = '?';
  let hasPenta = false;

  for (const m of matchStats) {
    if (m.kills > bestKills) {
      bestKills = m.kills;
      bestKillsMap = m.map;
    }
    if (m.result === 'L' && m.kills > bestKillsLoss) {
      bestKillsLoss = m.kills;
      bestKillsLossMap = m.map;
    }
    if (m.pentaKills > 0) hasPenta = true;
  }

  const earned: Array<{ icon: string; name: string; detail: string }> = [];

  // Milestone achievements
  if (totalMatches >= 100) earned.push({ icon: '🎮', name: 'Century Club', detail: `${totalMatches} matches played` });
  if (totalMatches >= 500) earned.push({ icon: '⚔️', name: 'Veteran', detail: `${totalMatches} matches played` });

  // Streak achievements
  if (longestStreak >= 10) earned.push({ icon: '🚀', name: 'Unstoppable', detail: `${longestStreak}-game best win streak` });
  if (currentStreak >= 3) earned.push({ icon: '🔥', name: 'On Fire', detail: `Currently on a ${currentStreak}-game win streak` });
  if (maxLossStreak >= 5) earned.push({ icon: '😤', name: 'Tilt Queue', detail: `${maxLossStreak}-game loss streak (ouch)` });

  // Late night achievements
  if (lateNightMatches.length >= 1) earned.push({ icon: '🌙', name: 'Go To Bed', detail: `${lateNightMatches.length} late-night match${lateNightMatches.length !== 1 ? 'es' : ''} (11 PM – 5 AM)` });
  if (lateNightMatches.length >= 10) earned.push({ icon: '🦉', name: 'The Insomniac', detail: `${lateNightMatches.length} late-night matches` });

  // Kill achievements
  if (bestKills >= 30) earned.push({ icon: '💣', name: 'Thirty Bomb', detail: `${bestKills}K on ${bestKillsMap}` });
  if (bestKills >= 35) earned.push({ icon: '🤯', name: 'Thirty-Five?!', detail: `${bestKills}K on ${bestKillsMap}` });
  if (bestKillsLoss >= 30) earned.push({ icon: '🏋️', name: 'The Hard Carry', detail: `${bestKillsLoss}K in a losing match on ${bestKillsLossMap}` });
  if (hasPenta) earned.push({ icon: '⭐', name: 'Ace', detail: 'Got a penta kill' });

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setAuthor({
      name: player.nickname,
      url: `https://www.faceit.com/en/players/${encodeURIComponent(player.nickname)}`,
      iconURL: player.avatar || undefined,
    })
    .setTitle(`Achievements — ${earned.length} earned`);

  if (earned.length) {
    embed.setDescription(
      earned.map((a) => `${a.icon}  **${a.name}**\n${a.detail}`).join('\n\n'),
    );
  } else {
    embed.setDescription('No achievements unlocked yet. Keep playing!');
  }

  embed
    .setFooter({ text: 'Kill achievements based on last 50 matches · Streak and late-night from last 100' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
