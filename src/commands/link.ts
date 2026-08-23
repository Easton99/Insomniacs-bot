import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { db } from '../database/client';
import { FaceitNotFoundError, FaceitUnconfiguredError, getPlayerByNickname } from '../services/faceit';
import logger from '../utils/logger';

export const subcommand = new SlashCommandSubcommandBuilder()
  .setName('link')
  .setDescription('Link your Discord account to your FACEIT account')
  .addStringOption((opt) =>
    opt.setName('faceit').setDescription('Your FACEIT nickname (case-insensitive)').setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const nickname = interaction.options.getString('faceit', true).trim();

  const existing = await db.discordUser.findUnique({ where: { discordId: interaction.user.id } });
  if (existing) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff6b35)
          .setTitle('Already linked')
          .setDescription(
            `Your account is already linked to **${existing.faceitNickname}**.\nUse \`/ic unlink\` first if you want to switch accounts.`,
          ),
      ],
    });
    return;
  }

  let player;
  try {
    player = await getPlayerByNickname(nickname);
  } catch (err) {
    if (err instanceof FaceitNotFoundError) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xcc3333)
            .setTitle('Player not found')
            .setDescription(
              `No FACEIT account found for **${nickname}**.\nCheck the spelling — nicknames are case-insensitive.`,
            ),
        ],
      });
      return;
    }
    if (err instanceof FaceitUnconfiguredError) {
      await interaction.editReply({ content: 'FACEIT integration is not configured on this bot.' });
      return;
    }
    logger.error({ err, nickname }, 'FACEIT API error during /ic link');
    await interaction.editReply({ content: 'Could not reach the FACEIT API right now. Try again in a moment.' });
    return;
  }

  if (!player.games?.cs2) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xcc3333)
          .setTitle('No CS2 data')
          .setDescription(`**${player.nickname}** doesn't have CS2 linked on FACEIT.`),
      ],
    });
    return;
  }

  const conflict = await db.discordUser.findUnique({ where: { faceitId: player.player_id } });
  if (conflict) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xcc3333)
          .setTitle('Already claimed')
          .setDescription(`**${player.nickname}** is already linked to another Discord account.`),
      ],
    });
    return;
  }

  await db.discordUser.create({
    data: {
      discordId: interaction.user.id,
      faceitId: player.player_id,
      faceitNickname: player.nickname,
    },
  });

  const cs2 = player.games.cs2;
  const embed = new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle('Account linked ✓')
    .setDescription(`Your Discord is now linked to **${player.nickname}** on FACEIT.`)
    .addFields(
      { name: 'ELO', value: cs2.faceit_elo.toString(), inline: true },
      { name: 'Level', value: cs2.skill_level.toString(), inline: true },
    )
    .setTimestamp();

  if (player.avatar) embed.setThumbnail(player.avatar);

  await interaction.editReply({ embeds: [embed] });
}
