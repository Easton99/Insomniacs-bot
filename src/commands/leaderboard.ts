import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandSubcommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, FaceitRateLimitError, getPlayerById, getPlayerLifetimeStats } from '../services/faceit';
import { LEADERBOARD_SELECT_ID } from '../utils/interaction-handler';
import logger from '../utils/logger';

const CATEGORIES = [
  { value: 'elo', label: 'ELO', description: 'Current FACEIT ELO', emoji: '📊' },
  { value: 'kd', label: 'K/D Ratio', description: 'Average K/D over all matches', emoji: '🎯' },
  { value: 'winrate', label: 'Win Rate', description: 'Lifetime win rate %', emoji: '🏆' },
  { value: 'hs', label: 'Headshots %', description: 'Average headshot percentage', emoji: '💀' },
  { value: 'matches', label: 'Matches Played', description: 'Total FACEIT CS2 matches', emoji: '🎮' },
  { value: 'streak', label: 'Best Win Streak', description: 'Longest win streak ever', emoji: '🔥' },
] as const;

type Category = (typeof CATEGORIES)[number]['value'];

interface PlayerRow {
  nickname: string;
  avatar: string;
  elo: number;
  level: number;
  kd: number;
  winrate: number;
  hs: number;
  matches: number;
  streak: number;
}

function selectMenu(selected: Category): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(LEADERBOARD_SELECT_ID)
    .setPlaceholder('Choose a category…')
    .addOptions(
      CATEGORIES.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setValue(c.value)
          .setLabel(c.label)
          .setDescription(c.description)
          .setEmoji(c.emoji)
          .setDefault(c.value === selected),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

async function fetchAllPlayers(): Promise<PlayerRow[]> {
  const users = await db.discordUser.findMany();
  if (!users.length) return [];

  const results = await Promise.allSettled(
    users.map((u) =>
      Promise.all([getPlayerById(u.faceitId), getPlayerLifetimeStats(u.faceitId)]),
    ),
  );

  const rows: PlayerRow[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      if (r.reason instanceof FaceitRateLimitError) throw r.reason;
      if (r.reason instanceof FaceitApiError) logger.warn({ faceitId: users[i].faceitId }, 'Skipping player — API error');
      continue;
    }
    const [player, stats] = r.value;
    const lt = stats.lifetime;
    const cs2 = player.games?.cs2;
    rows.push({
      nickname: player.nickname,
      avatar: player.avatar ?? '',
      elo: cs2?.faceit_elo ?? 0,
      level: cs2?.skill_level ?? 0,
      kd: parseFloat((lt['Average K/D Ratio'] as string) ?? '0'),
      winrate: parseFloat((lt['Win Rate %'] as string) ?? '0'),
      hs: parseFloat((lt['Average Headshots %'] as string) ?? '0'),
      matches: parseInt((lt['Matches'] as string) ?? '0', 10),
      streak: parseInt((lt['Longest Win Streak'] as string) ?? '0', 10),
    });
  }
  return rows;
}

function buildEmbed(rows: PlayerRow[], category: Category): EmbedBuilder {
  const cat = CATEGORIES.find((c) => c.value === category)!;

  const sorted = [...rows].sort((a, b) => b[category] - a[category]);

  const MEDALS = ['🥇', '🥈', '🥉'];

  const lines = sorted.map((p, i) => {
    const medal = i < 3 ? MEDALS[i] : `${i + 1}.`;
    let val: string;
    switch (category) {
      case 'elo':
        val = `${p.elo} ELO  (Lvl ${p.level})`;
        break;
      case 'kd':
        val = p.kd.toFixed(2);
        break;
      case 'winrate':
        val = `${p.winrate.toFixed(1)}%`;
        break;
      case 'hs':
        val = `${p.hs.toFixed(1)}%`;
        break;
      case 'matches':
        val = p.matches.toString();
        break;
      case 'streak':
        val = p.streak.toString();
        break;
    }
    return `${medal}  **${p.nickname}** — ${val}`;
  });

  return new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle(`${cat.emoji} Insomniacs Leaderboard — ${cat.label}`)
    .setDescription(lines.join('\n') || 'No players found.')
    .setTimestamp()
    .setFooter({ text: 'Use the menu below to switch categories' });
}

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('leaderboard')
  .setDescription('Insomniacs ranked leaderboard — use the menu to switch categories');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const users = await db.discordUser.findMany();
  if (users.length < 2) {
    await interaction.editReply({
      content: 'At least 2 players need to link their FACEIT accounts before the leaderboard is available.',
    });
    return;
  }

  const rows = await fetchAllPlayers();
  if (!rows.length) {
    await interaction.editReply({ content: 'Could not load player data right now.' });
    return;
  }

  await interaction.editReply({
    embeds: [buildEmbed(rows, 'elo')],
    components: [selectMenu('elo')],
  });
}

export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferUpdate();

  const category = interaction.values[0] as Category;
  const rows = await fetchAllPlayers();

  if (!rows.length) {
    await interaction.editReply({ content: 'Could not load player data right now.', components: [] });
    return;
  }

  await interaction.editReply({
    embeds: [buildEmbed(rows, category)],
    components: [selectMenu(category)],
  });
}
