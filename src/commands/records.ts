import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { getPlayerById, getPlayerLifetimeStats } from '../services/faceit';
import { fetchMatchesWithStats } from '../utils/match-utils';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('records')
  .setDescription('Insomniacs all-time record book across all linked players');

interface PlayerRecord {
  nickname: string;
  elo: number;
  level: number;
  kd: number;
  winRate: number;
  totalMatches: number;
  longestStreak: number;
  bestKills: number;
  bestKillsMap: string;
  bestKillsWon: boolean;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const users = await db.discordUser.findMany();
  if (users.length === 0) {
    await interaction.editReply({ content: 'No linked players yet.' });
    return;
  }

  // Fetch lifetime stats + recent match stats for all players in parallel
  const playerResults = await Promise.allSettled(
    users.map(async (u) => {
      const [player, stats, matches] = await Promise.all([
        getPlayerById(u.faceitId),
        getPlayerLifetimeStats(u.faceitId),
        fetchMatchesWithStats(u.faceitId, 20),
      ]);

      const lt = stats.lifetime;
      const cs2 = player.games?.cs2;

      const bestKillsMatch = matches.length
        ? matches.reduce((best, m) => (m.kills > best.kills ? m : best))
        : null;

      return {
        nickname: player.nickname,
        elo: cs2?.faceit_elo ?? 0,
        level: cs2?.skill_level ?? 0,
        kd: parseFloat((lt['Average K/D Ratio'] as string) ?? '0'),
        winRate: parseFloat((lt['Win Rate %'] as string) ?? '0'),
        totalMatches: parseInt((lt['Matches'] as string) ?? '0', 10),
        longestStreak: parseInt((lt['Longest Win Streak'] as string) ?? '0', 10),
        bestKills: bestKillsMatch?.kills ?? 0,
        bestKillsMap: bestKillsMatch?.map ?? '?',
        bestKillsWon: bestKillsMatch?.result === 'W',
      } satisfies PlayerRecord;
    }),
  );

  const records: PlayerRecord[] = [];
  for (const r of playerResults) {
    if (r.status === 'rejected') {
      logger.warn({ err: r.reason }, 'Skipping player in /ic records due to API error');
    } else {
      records.push(r.value);
    }
  }

  if (!records.length) {
    await interaction.editReply({ content: 'Could not load player data right now.' });
    return;
  }

  const top = <T>(fn: (r: PlayerRecord) => T, compare = (a: T, b: T) => (a > b ? -1 : 1)) => {
    const sorted = [...records].sort((a, b) => compare(fn(a), fn(b)));
    return sorted[0];
  };

  const eloLeader = top((r) => r.elo);
  const kdLeader = top((r) => r.kd);
  const wrLeader = top((r) => r.winRate);
  const streakLeader = top((r) => r.longestStreak);
  const matchesLeader = top((r) => r.totalMatches);
  const killsLeader = top((r) => r.bestKills);

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle('Insomniacs Record Book')
    .addFields(
      {
        name: '📊 Highest ELO',
        value: `**${eloLeader.nickname}** — ${eloLeader.elo} (Lvl ${eloLeader.level})`,
      },
      {
        name: '🎯 Best K/D',
        value: `**${kdLeader.nickname}** — ${kdLeader.kd.toFixed(2)}`,
      },
      {
        name: '🏆 Best Win Rate',
        value: `**${wrLeader.nickname}** — ${wrLeader.winRate.toFixed(1)}%`,
      },
      {
        name: '🔥 Longest Win Streak',
        value: `**${streakLeader.nickname}** — ${streakLeader.longestStreak} games`,
      },
      {
        name: '🎮 Most Matches',
        value: `**${matchesLeader.nickname}** — ${matchesLeader.totalMatches}`,
      },
      {
        name: '💣 Best Kill Game',
        value: killsLeader.bestKills > 0
          ? `**${killsLeader.nickname}** — ${killsLeader.bestKills}K on ${killsLeader.bestKillsMap} (${killsLeader.bestKillsWon ? 'W' : 'L'})`
          : '—',
      },
    )
    .setFooter({ text: 'Kill records based on last 20 matches per player' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
