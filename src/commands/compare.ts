import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitApiError, getPlayerById, getPlayerLifetimeStats } from '../services/faceit';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('compare')
  .setDescription('Head-to-head stats comparison between two linked players')
  .addUserOption((opt) =>
    opt.setName('player1').setDescription('First player').setRequired(true),
  )
  .addUserOption((opt) =>
    opt.setName('player2').setDescription('Second player').setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const u1 = interaction.options.getUser('player1', true);
  const u2 = interaction.options.getUser('player2', true);

  if (u1.id === u2.id) {
    await interaction.editReply({ content: 'Pick two different players.' });
    return;
  }

  const [link1, link2] = await Promise.all([
    db.discordUser.findUnique({ where: { discordId: u1.id } }),
    db.discordUser.findUnique({ where: { discordId: u2.id } }),
  ]);

  const missing: string[] = [];
  if (!link1) missing.push(`<@${u1.id}>`);
  if (!link2) missing.push(`<@${u2.id}>`);
  if (missing.length) {
    await interaction.editReply({ content: `${missing.join(' and ')} ${missing.length === 1 ? "hasn't" : "haven't"} linked a FACEIT account.` });
    return;
  }

  let p1data, p2data;
  try {
    [p1data, p2data] = await Promise.all([
      Promise.all([getPlayerById(link1!.faceitId), getPlayerLifetimeStats(link1!.faceitId)]),
      Promise.all([getPlayerById(link2!.faceitId), getPlayerLifetimeStats(link2!.faceitId)]),
    ]);
  } catch (err) {
    if (err instanceof FaceitApiError) logger.error({ err }, 'FACEIT API error during /ic compare');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  const [p1, s1] = p1data;
  const [p2, s2] = p2data;

  const str = (stats: typeof s1, key: string) => {
    const v = stats.lifetime[key];
    return Array.isArray(v) ? v.join(',') : (v ?? '?');
  };

  const p1cs2 = p1.games?.cs2;
  const p2cs2 = p2.games?.cs2;

  // Build comparison columns: [p1 value] [stat label] [p2 value]
  const stats: Array<[string, string, string]> = [
    [p1cs2?.faceit_elo.toString() ?? '?', 'ELO', p2cs2?.faceit_elo.toString() ?? '?'],
    [p1cs2?.skill_level.toString() ?? '?', 'Level', p2cs2?.skill_level.toString() ?? '?'],
    [str(s1, 'Average K/D Ratio'), 'K/D', str(s2, 'Average K/D Ratio')],
    [`${str(s1, 'Win Rate %')}%`, 'Win Rate', `${str(s2, 'Win Rate %')}%`],
    [`${str(s1, 'Average Headshots %')}%`, 'HS%', `${str(s2, 'Average Headshots %')}%`],
    [str(s1, 'Matches'), 'Matches', str(s2, 'Matches')],
    [str(s1, 'Longest Win Streak'), 'Best Streak', str(s2, 'Longest Win Streak')],
  ];

  const p1col = stats.map(([v]) => v).join('\n');
  const labelCol = stats.map(([, l]) => l).join('\n');
  const p2col = stats.map(([, , v]) => v).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle(`${p1.nickname}  vs  ${p2.nickname}`)
    .addFields(
      { name: p1.nickname, value: p1col, inline: true },
      { name: '—', value: labelCol, inline: true },
      { name: p2.nickname, value: p2col, inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
